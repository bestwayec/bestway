import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
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

  const title = "BestWay — IELTS va Multi-Level (CEFR) Mock Imtihon Platformasi";
  const description =
    locale === "en"
      ? "BestWay Education Center — Advanced Computer-Based IELTS and Multi-Level (CEFR) mock testing platform with AI assessment, score prediction, and comprehensive exam analytics."
      : "BestWay o'quv markazi — IELTS va Milliy Sertifikat (Multi-Level CEFR) mock imtihonlari, AI orqali Speaking va Writing tekshiruvi, ball bashorati va o'quvchilar tahlil tizimi.";

  const baseUrl = "https://bestwayec.uz";
  const canonicalUrl = locale === "uz" ? baseUrl : `${baseUrl}/${locale}`;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: title,
      template: `%s · ${CENTER.name}`,
    },
    description,
    applicationName: CENTER.name,
    keywords: [
      "bestwayec",
      "bestway",
      "bestway uz",
      "bestway education",
      "bestway o'quv markazi",
      "ielts mock test",
      "ielts mock imtihon",
      "multilevel mock",
      "cefr mock test",
      "dtm milliy sertifikat",
      "speaking ai tekshirish",
      "writing ai baholash",
      "shofirkon ingliz tili",
      "buxoro ielts",
      "computer based test",
    ],
    authors: [{ name: CENTER.founder }],
    creator: CENTER.name,
    publisher: CENTER.name,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        uz: baseUrl,
        en: `${baseUrl}/en`,
      },
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: "BestWay Education",
      locale: locale === "uz" ? "uz_UZ" : "en_US",
      type: "website",
      images: [
        {
          url: "/logo-800.png",
          width: 800,
          height: 800,
          alt: "BestWay Education Center Logo",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/logo-800.png"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
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

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "EducationalOrganization",
        "@id": "https://bestwayec.uz/#organization",
        name: "BestWay Education Center",
        alternateName: ["BestWay", "bestwayec", "Best Way O'quv Markazi"],
        url: "https://bestwayec.uz",
        logo: "https://bestwayec.uz/logo-800.png",
        description: "Ingliz tili, IELTS va Multi-Level (CEFR) xalqaro imtihonlariga tayyorlov platformasi va o'quv markazi.",
        founder: {
          "@type": "Person",
          name: CENTER.founder,
        },
        foundingDate: "2007",
        address: {
          "@type": "PostalAddress",
          streetAddress: CENTER.address,
          addressLocality: "Shofirkon",
          addressRegion: "Buxoro viloyati",
          addressCountry: "UZ",
        },
        telephone: CENTER.phone,
        email: CENTER.email,
        sameAs: [
          CENTER.telegram,
          CENTER.instagram,
        ],
      },
      {
        "@type": "Course",
        "@id": "https://bestwayec.uz/#course-ielts-multilevel",
        name: "IELTS & Multi-Level (CEFR) Mock Exam CBT Platform",
        description: "Real imtihon muhiti (Computer-Based Test), AI asosidagi tezkor Speaking va Writing tekshiruv tizimi, ball bashorati va zaif nuqtalar xaritasi.",
        provider: {
          "@id": "https://bestwayec.uz/#organization",
        },
        educationalCredentialAwarded: "CEFR B1-C1 / IELTS 4.0-9.0 Score Predictor",
        hasCourseInstance: {
          "@type": "CourseInstance",
          courseMode: "Online & In-Person",
          courseWorkload: "PT2H",
        },
      },
    ],
  };

  return (
    // Dark-only — white/light theme deleted. `<html>` is always `dark`.
    <html lang={locale} data-scroll-behavior="smooth" className={`${inter.variable} dark h-full`} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="flex min-h-full flex-col antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
