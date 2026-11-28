import { defineRouting } from "next-intl/routing";

export const locales = ["uz", "en"] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  uz: "O'zbekcha",
  en: "English",
};

export const routing = defineRouting({
  locales,
  defaultLocale: "uz",
  // O'zbekcha uchun prefiks yo'q (/dashboard), inglizchada /en prefiksi bor.
  localePrefix: "as-needed",
  // The app has no basePath. Without an explicit path, next-intl's client switcher derives one from the URL and
  // mistakes the "/en" locale prefix for a basePath: switching /en/... -> Uzbek wrote NEXT_LOCALE=uz with Path=/en,
  // so the older Path=/ cookie ("en") won on every unprefixed URL and the next link went back to English.
  // Same attributes the middleware already uses (name, Path=/, SameSite=Lax, session cookie).
  localeCookie: { name: "NEXT_LOCALE", path: "/", sameSite: "lax" },
});
