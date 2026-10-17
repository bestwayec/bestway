import type { ApiResponse, PageMeta } from "./types";

/** Backend qaytargan xatolik — `code` bo'yicha UI qaror qabul qiladi */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Brauzerdan API chaqirish. Har doim Next proxy orqali —
 * token cookie'da qoladi, JS uni ko'rmaydi (`/api/backend/[...path]`).
 */
const BASE = "/api/backend";

/**
 * Exam session signature issued by the server when an attempt starts/resumes.
 * Echoed back on answer/submit calls so forged or replayed requests are rejected.
 */
const attemptSignatures = new Map<string, string>();
const ATTEMPT_MUTATION = /^\/mock\/attempts\/([^/]+)\/(?:answers?|submit|advance|writing)(?:\/|$)/;

function normalizePath(path: string): string {
  if (path.startsWith("/api/backend/")) return path.slice("/api/backend".length);
  if (path.startsWith("/api/v1/")) return path.slice("/api/v1".length);
  if (path.startsWith("/v1/")) return path.slice("/v1".length);
  return path.startsWith("/") ? path : `/${path}`;
}

function rememberAttemptSignature(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const { attemptId, sessionSignature, attemptToken } = data as {
    attemptId?: unknown;
    sessionSignature?: unknown;
    attemptToken?: unknown;
  };
  const sig =
    typeof sessionSignature === "string"
      ? sessionSignature
      : typeof attemptToken === "string"
        ? attemptToken
        : undefined;
  if (typeof attemptId === "string" && sig) {
    attemptSignatures.set(attemptId, sig);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(`bw_attempt_token_${attemptId}`, sig);
      } catch {
        // ignore storage quota errors
      }
    }
  }
}

function signatureHeader(path: string): Record<string, string> {
  const normalized = normalizePath(path);
  const id = ATTEMPT_MUTATION.exec(normalized)?.[1];
  let signature = id ? attemptSignatures.get(id) : undefined;
  if (!signature && id && typeof window !== "undefined") {
    try {
      signature = sessionStorage.getItem(`bw_attempt_token_${id}`) ?? undefined;
    } catch {
      // ignore storage errors
    }
  }
  return signature ? { "x-attempt-signature": signature } : {};
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Query parametrlari — undefined/null qiymatlar tashlab yuboriladi */
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const isFormData = body instanceof FormData;
  const cleanPath = normalizePath(path);

  const res = await fetch(`${BASE}${cleanPath}${buildQuery(query)}`, {
    ...rest,
    headers: {
      ...(isFormData ? {} : body !== undefined ? { "content-type": "application/json" } : {}),
      ...signatureHeader(cleanPath),
      ...headers,
    },
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  // Uploadlar (audio/rasm) katta bo'lganda oraliq server JSON emas, oddiy
  // xatolik qaytarishi mumkin — res.json() crash bo'lmasligi uchun.
  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(
      res.status === 413 ? "FILE_TOO_LARGE" : "UPSTREAM",
      res.statusText ? `${res.statusText} (${res.status})` : `Server error (${res.status})`,
      res.status,
    );
  }

  if (!res.ok || !json.success) {
    const error = "error" in json ? json.error : undefined;
    throw new ApiError(
      error?.code ?? "UNKNOWN",
      error?.message ?? "Kutilmagan xatolik yuz berdi",
      res.status,
    );
  }

  rememberAttemptSignature(json.data);
  return json.data;
}

/** Pagination bilan keladigan ro'yxatlar uchun — `meta` ham kerak bo'lganda */
async function requestPaged<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: PageMeta }> {
  const { body, query, headers, ...rest } = options;
  const cleanPath = normalizePath(path);
  const res = await fetch(`${BASE}${cleanPath}${buildQuery(query)}`, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || !json.success) {
    const error = "error" in json ? json.error : undefined;
    throw new ApiError(
      error?.code ?? "UNKNOWN",
      error?.message ?? "Kutilmagan xatolik yuz berdi",
      res.status,
    );
  }
  return { data: json.data, meta: json.meta };
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) =>
    request<T>(path, { method: "GET", query }),

  getPaged: <T>(path: string, query?: RequestOptions["query"]) =>
    requestPaged<T>(path, { method: "GET", query }),

  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),

  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),

  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  downloadBlob: async (
    path: string,
    query?: RequestOptions["query"],
  ): Promise<{ blob: Blob; filename?: string }> => {
    const cleanPath = normalizePath(path);
    const res = await fetch(`${BASE}${cleanPath}${buildQuery(query)}`, {
      method: "GET",
      headers: {
        ...signatureHeader(cleanPath),
      },
    });
    if (!res.ok) {
      let errMsg = `Yuklab olishda xatolik (${res.status})`;
      let errCode = "EXPORT_FAILED";
      try {
        const json = (await res.json()) as { error?: { code?: string; message?: string } };
        if (json?.error?.message) errMsg = json.error.message;
        if (json?.error?.code) errCode = json.error.code;
      } catch {
        // non-json error response
      }
      throw new ApiError(errCode, errMsg, res.status);
    }
    const cd = res.headers.get("content-disposition") ?? "";
    const match = /filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i.exec(cd);
    const filename = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    const blob = await res.blob();
    return { blob, filename };
  },
};

/** Auth route'lari proxy orqali emas, alohida handler'lar orqali ketadi */
export const authApi = {
  async login(phone: string, password: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    let json: ApiResponse<{ user: import("./types").PublicUser }> | undefined;
    try {
      json = (await res.json()) as ApiResponse<{ user: import("./types").PublicUser }>;
    } catch {
      throw new ApiError("SERVER_ERROR", "Serverdan noto'g'ri javob keldi", res.status);
    }
    if (!res.ok || !json?.success) {
      const error = json && "error" in json ? json.error : undefined;
      throw new ApiError(error?.code ?? "UNKNOWN", error?.message ?? "Telefon raqam yoki parol noto'g'ri", res.status);
    }
    return json.data.user;
  },

  async telegramLogin(data: Record<string, unknown>) {
    const res = await fetch("/api/auth/telegram-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    let json: ApiResponse<{ user: import("./types").PublicUser }> | undefined;
    try {
      json = (await res.json()) as ApiResponse<{ user: import("./types").PublicUser }>;
    } catch {
      throw new ApiError("SERVER_ERROR", "Serverdan noto'g'ri javob keldi", res.status);
    }
    if (!res.ok || !json?.success) {
      const error = json && "error" in json ? json.error : undefined;
      throw new ApiError(error?.code ?? "UNKNOWN", error?.message ?? "Telegram orqali kirishda xatolik", res.status);
    }
    return json.data.user;
  },

  async telegramOtpLogin(code: string) {
    const res = await fetch("/api/auth/telegram-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    let json: ApiResponse<{ user: import("./types").PublicUser }> | undefined;
    try {
      json = (await res.json()) as ApiResponse<{ user: import("./types").PublicUser }>;
    } catch {
      throw new ApiError("SERVER_ERROR", "Serverdan noto'g'ri javob keldi", res.status);
    }
    if (!res.ok || !json?.success) {
      const error = json && "error" in json ? json.error : undefined;
      throw new ApiError(error?.code ?? "UNKNOWN", error?.message ?? "Telegram kod noto'g'ri yoki eskirgan", res.status);
    }
    return json.data.user;
  },

  async googleAuth(credential: string, role: "student" | "parent" = "student") {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential, role }),
    });
    const json = (await res.json()) as ApiResponse<{ user: import("./types").PublicUser }>;
    if (!res.ok || !json.success) {
      const error = "error" in json ? json.error : undefined;
      throw new ApiError(error?.code ?? "UNKNOWN", error?.message ?? "Google orqali kirishda xatolik", res.status);
    }
    return json.data.user;
  },

  async register(input: { name: string; phone: string; password: string; role: "student" | "parent" }) {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as ApiResponse<{ user: import("./types").PublicUser }>;
    if (!res.ok || !json.success) {
      const error = "error" in json ? json.error : undefined;
      throw new ApiError(
        error?.code ?? "UNKNOWN",
        error?.message ?? "Ro'yxatdan o'tishda xatolik",
        res.status,
      );
    }
    return json.data.user;
  },

  async logout() {
    await fetch("/api/auth/logout", { method: "POST" });
  },
};
