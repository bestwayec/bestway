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

  const res = await fetch(`${BASE}${path}${buildQuery(query)}`, {
    ...rest,
    headers: {
      ...(isFormData ? {} : body !== undefined ? { "content-type": "application/json" } : {}),
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

  return json.data;
}

/** Pagination bilan keladigan ro'yxatlar uchun — `meta` ham kerak bo'lganda */
async function requestPaged<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: PageMeta }> {
  const { body, query, headers, ...rest } = options;
  const res = await fetch(`${BASE}${path}${buildQuery(query)}`, {
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
};

/** Auth route'lari proxy orqali emas, alohida handler'lar orqali ketadi */
export const authApi = {
  async login(phone: string, password: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    const json = (await res.json()) as ApiResponse<{ user: import("./types").PublicUser }>;
    if (!res.ok || !json.success) {
      const error = "error" in json ? json.error : undefined;
      throw new ApiError(error?.code ?? "UNKNOWN", error?.message ?? "Kirishda xatolik", res.status);
    }
    return json.data.user;
  },

  async telegramLogin(data: Record<string, unknown>) {
    const res = await fetch("/api/auth/telegram-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = (await res.json()) as ApiResponse<{ user: import("./types").PublicUser }>;
    if (!res.ok || !json.success) {
      const error = "error" in json ? json.error : undefined;
      throw new ApiError(error?.code ?? "UNKNOWN", error?.message ?? "Telegram orqali kirishda xatolik", res.status);
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
