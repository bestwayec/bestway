import createIntlMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { locales, routing, type Locale } from "@/i18n/routing";
import { COOKIE } from "@/lib/config";
import type { Role } from "@/lib/types";
import { homePathForRole } from "@/lib/role-routing";

// Next.js 16: "middleware" -> "proxy" (funksionallik o'zgarmagan)
const intlProxy = createIntlMiddleware(routing);

/** Mehmonlar uchun ochiq sahifalar — auth yo'q bo'lsa ham kirish mumkin */
const PUBLIC_PREFIXES = ["/demo"];

 /**
 * Login talab qiladigan bo'limlar.
 *
 * Diqqat: bu faqat foydalanuvchini keraksiz sahifadan qaytarish uchun (UX).
 * Haqiqiy himoya backendda — har bir endpoint JWT imzosini va rolni tekshiradi.
 * Cookie'ni qo'lda o'zgartirgan odam bu yerdan o'tsa ham, backend uni to'xtatadi.
 * /demo ataylab yo'q — mehmonlar demo testni ko'ra olishi kerak.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/super-admin",
  "/attendance",
  "/payments",
  "/students",
  "/staff",
  "/groups",
  "/points",
  "/articles",
  "/gallery",
  "/leaderboard",
  "/notifications",
  "/settings",
  "/audit",
  "/profile",
  "/my",
  "/children",
  "/tests",
  "/mock",
  "/exam-builder",
  "/videos",
];

/** Login qilgan foydalanuvchi bu sahifalarga qaytmasligi kerak */
const AUTH_PAGES = ["/login", "/register"];

/** Prefiks -> ruxsat etilgan rollar (backend controllerlardagi @Roles bilan bir xil) */
const ROUTE_ROLES: [string, Role[]][] = [
  ["/attendance", ["teacher", "admin", "super_admin"]],
  ["/payments", ["teacher", "admin", "super_admin"]],
  ["/students", ["admin", "super_admin"]],
  ["/staff", ["admin", "super_admin"]],
  ["/groups", ["teacher", "admin", "super_admin"]],
  ["/articles", ["admin", "super_admin"]],
  ["/gallery", ["admin", "super_admin"]],
  ["/mock", ["student", "teacher", "admin", "super_admin"]],
  ["/exam-builder", ["teacher", "admin", "super_admin"]],
  ["/settings", ["super_admin"]],
  ["/audit", ["super_admin"]],
  ["/my", ["student", "parent"]],
  ["/children", ["parent"]],
];

/** "/en/dashboard" -> { locale: "en", path: "/dashboard" } */
function splitLocale(pathname: string): { locale: Locale; path: string } {
  const segment = pathname.split("/")[1];
  if (locales.includes(segment as Locale)) {
    const rest = pathname.slice(segment.length + 1);
    return { locale: segment as Locale, path: rest || "/" };
  }
  return { locale: routing.defaultLocale, path: pathname };
}

/** Til prefiksini qaytadan qo'shadi (default til uchun prefiks yo'q — localePrefix: "as-needed") */
function withLocale(locale: Locale, path: string): string {
  return locale === routing.defaultLocale ? path : `/${locale}${path}`;
}

function matches(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

function decodeRole(token: string | undefined): Role | undefined {
  if (!token) return undefined;
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    let jsonStr: string;
    if (typeof atob === "function") {
      jsonStr = atob(padded);
    } else {
      jsonStr = Buffer.from(padded, "base64").toString("utf-8");
    }
    const data = JSON.parse(jsonStr) as { role?: Role };
    return data.role;
  } catch {
    return undefined;
  }
}

export default function proxy(req: NextRequest) {
  const { locale, path } = splitLocale(req.nextUrl.pathname);
  // Preserve old admin bookmarks, locale and query parameters.
  if (path === "/admin" || path === "/admin/") {
    const url = new URL(req.url);
    url.pathname = withLocale(locale, "/super-admin");
    return NextResponse.redirect(url);
  }
  // Legacy "/tests" bo'limi o'chirildi — hamma imtihonlar "/mock" da (Exams).
  // Eski bookmarklar 404 emas, Exams ga tushadi.
  if (matches(path, ["/tests"])) {
    const url = req.nextUrl.clone();
    url.pathname = withLocale(locale, "/mock");
    url.search = "";
    return NextResponse.redirect(url);
  }
  // /demo va boshqa ochiq sahifalar — darhol intl middleware'ga o'tkazamiz
  if (matches(path, PUBLIC_PREFIXES)) {
    return intlProxy(req);
  }
  const accessToken = req.cookies.get(COOKIE.access)?.value;
  const roleFromJwt = decodeRole(accessToken);
  const role = (roleFromJwt ?? req.cookies.get(COOKIE.role)?.value) as Role | undefined;

  if (matches(path, PROTECTED_PREFIXES) && !role) {
    if (req.cookies.has(COOKIE.refresh) && (path === "/super-admin" || path === "/dashboard")) {
      const url = req.nextUrl.clone();
      url.pathname = "/api/auth/resume";
      url.search = "";
      url.searchParams.set("next", withLocale(locale, path));
      return NextResponse.redirect(url);
    }
    const url = req.nextUrl.clone();
    url.pathname = withLocale(locale, "/login");
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (matches(path, AUTH_PAGES) && role && req.cookies.has(COOKIE.access) && req.nextUrl.searchParams.get("reauth") !== "1") {
    const url = req.nextUrl.clone();
    url.pathname = withLocale(locale, homePathForRole(role));
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (role) {
    const rule = ROUTE_ROLES.find(([prefix]) => matches(path, [prefix]));
    if (rule && !rule[1].includes(role)) {
      const url = req.nextUrl.clone();
      url.pathname = withLocale(locale, homePathForRole(role));
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return intlProxy(req);
}

export const config = {
  // API route'lari, statik fayllar va fayl kengaytmasi borlar chetlab o'tiladi
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
