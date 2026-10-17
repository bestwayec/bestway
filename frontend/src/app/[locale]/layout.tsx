import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Providers } from "@/components/providers";
import { CENTER } from "@/lib/config";
import { routing } from "@/i18n/routing";
import "../globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1.0,
  maximumScale: 5.0,
  userScalable: true,
  viewportFit: "cover",
};

// Inter — lotin yozuvidagi uz/en uchun. globals.css uni --font-inter orqali oladi.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
  preload: true,
  fallback: ["system-ui", "sans-serif"],
  adjustFontFallback: true,
});

// Qo'llab-quvvatlanadigan tillarni build vaqtida oldindan render qilamiz.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "marketing" });

  return {
    title: {
      default: `${CENTER.name} — ${CENTER.tagline}`,
      template: `%s · ${CENTER.name}`,
    },
    description: t("heroSubtitle"),
    applicationName: CENTER.name,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Noma'lum til — 404 (middleware odatda bunga yo'l qo'ymaydi, lekin himoya sifatida)
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Statik render uchun tilni so'rov kontekstiga bog'laymiz
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    // Dark-only — white/light theme deleted. `<html>` is always `dark`.
    <html lang={locale} data-scroll-behavior="smooth" className={`${inter.variable} dark h-full`} suppressHydrationWarning>
      <head />
      <body className="flex min-h-full flex-col antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
