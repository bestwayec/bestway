import { API_URL } from "./config";
import type { ApiResponse, Article, MockExamDetail, MockExamListItem, TestDetail, TestListItem } from "./types";

/**
 * Ochiq (auth talab qilmaydigan) backend so'rovlari — rasmiy sayt uchun.
 * Faqat serverda ishlaydi. Backend o'chiq bo'lsa ham sayt qulamasin:
 * har qanday xatoda bo'sh natija qaytaramiz.
 *
 * `tags` — on-demand revalidatsiya uchun (masalan admin yangi maqola qo'shsa,
 * `/api/revalidate` shu tegni tozalaydi va yangilik darhol ko'rinadi).
 */
async function publicGet<T>(
  path: string,
  opts: { revalidate?: number; tags?: string[] } = {},
): Promise<T | null> {
  const { revalidate = 300, tags } = opts;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      next: { revalidate, ...(tags ? { tags } : {}) },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json && typeof json === "object") {
      if (json.success === false) return null;
      if (json.data !== undefined) return json.data;
      return json;
    }
    return null;
  } catch {
    // Backend o'chiq / tarmoq xatosi — sahifa baribir ishlashi kerak
    return null;
  }
}

/** Ochiq maqola so'rovlarining kesh tegi — admin o'zgartirsa shu teg tozalanadi */
export const ARTICLES_TAG = "articles";
export const GALLERY_TAG = "gallery";
export const TEACHERS_TAG = "teachers";
export const TESTS_TAG = "tests";
export const MOCK_EXAMS_TAG = "mock-exams";

/** So'nggi yangiliklar (rasmiy sayt bosh sahifasi uchun) */
export async function getLatestArticles(limit = 3): Promise<Article[]> {
  const data = await publicGet<Article[]>(`/articles?limit=${limit}`, { tags: [ARTICLES_TAG] });
  return data ?? [];
}

/** Barcha yangiliklar (yangiliklar sahifasi) */
export async function getArticles(limit = 24): Promise<Article[]> {
  const data = await publicGet<Article[]>(`/articles?limit=${limit}`, { tags: [ARTICLES_TAG] });
  return data ?? [];
}

/** Bitta maqola (yangilik tafsiloti) */
export async function getArticle(id: string): Promise<Article | null> {
  return publicGet<Article>(`/articles/${encodeURIComponent(id)}`, { tags: [ARTICLES_TAG] });
}

/** Galereya rasmlari (AccordionGallery uchun — ochiq) */
export async function getGalleryImages(): Promise<import("./types").GalleryImage[]> {
  const data = await publicGet<import("./types").GalleryImage[]>("/gallery", { tags: [GALLERY_TAG] });
  return data ?? [];
}

/** O'qituvchilar (fallback: agar galereya bo'sh bo'lsa) */
export async function getTeachersPublic(): Promise<
  { id: string; name: string; specialty: string; achievement?: string | null; photoUrl: string | null; socialUrl?: string | null }[]
> {
  const data = await publicGet<
    { id: string; name: string; specialty: string; achievement?: string | null; photoUrl: string | null; socialUrl?: string | null }[]
  >("/teachers", { tags: [TEACHERS_TAG] });
  return data ?? [];
}

/** Demo testlar (mehmonlar uchun — faqat isDemo=true) */
export async function getDemoTests(): Promise<TestListItem[]> {
  const data = await publicGet<TestListItem[]>("/tests", { revalidate: 60, tags: [TESTS_TAG] });
  if (!data) return [];
  // Backend mehmonlarga allaqachon faqat demo qaytaradi, lekin xavfsizlik uchun client-side filtr
  return data.filter((t) => t.isDemo);
}

/** Bitta demo test (OptionalAuth bo'lsa mehmon ham ko'radi; 401 bo'lsa null) */
export async function getDemoTest(id: string): Promise<TestDetail | null> {
  return publicGet<TestDetail>(`/tests/${encodeURIComponent(id)}`, {
    revalidate: 60,
    tags: [TESTS_TAG],
  });
}

/**
 * Demo mock imtihonlar (Exam Builder'da "Visible as a public demo").
 * Backend mehmonlarga allaqachon faqat demo qaytaradi, lekin xavfsizlik
 * uchun client-side filtr ham bor.
 */
export async function getDemoMockExams(): Promise<MockExamListItem[]> {
  const data = await publicGet<MockExamListItem[]>("/mock/exams", {
    revalidate: 60,
    tags: [MOCK_EXAMS_TAG],
  });
  if (!data) return [];
  return data.filter((e) => e.isDemo);
}

/** Bitta demo mock imtihon tafsiloti — mehmonlar uchun (javobsiz shakl) */
export async function getDemoMockExam(id: string): Promise<MockExamDetail | null> {
  return publicGet<MockExamDetail>(`/mock/exams/${encodeURIComponent(id)}`, {
    revalidate: 60,
    tags: [MOCK_EXAMS_TAG],
  });
}

import { normalizeExamPayload } from "./normalize-exam";

/** Hozirgi aktiv CD Record Mock imtihonini olish */
export async function getActiveCdExam(): Promise<MockExamDetail | null> {
  // Backend URL already has /v1 prefix; request /exams/active (without redundant /api/v1)
  let res = await publicGet<any>("/exams/active", {
    revalidate: 30,
    tags: [MOCK_EXAMS_TAG],
  });
  if (!res) {
    res = await publicGet<any>("/exams/active/", {
      revalidate: 30,
      tags: [MOCK_EXAMS_TAG],
    });
  }
  if (!res) {
    console.warn("[getActiveCdExam] Public GET /exams/active returned null, checking demo mock exams");
    const demos = await getDemoMockExams();
    if (demos.length > 0) {
      const demoDetail = await getDemoMockExam(demos[0].id);
      return demoDetail ? normalizeExamPayload(demoDetail) : null;
    }
    return null;
  }
  return normalizeExamPayload(res);
}
