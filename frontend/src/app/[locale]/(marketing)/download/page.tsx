import type { Metadata } from "next";
import DesktopPage from "../desktop/page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isEn = locale === "en";
  const title = isEn
    ? "Download BestWay App (Windows, macOS, Linux, Android APK) | BestWay"
    : "BestWay Ilovasini Yuklab Olish (Windows, macOS, Linux, Android APK) | BestWay";
  const description = isEn
    ? "Download the official BestWay examination and learning app for Windows 10/11, macOS, Linux, and Android APK. Kiosk mode, offline auto-save, and Subway Vocab Runner."
    : "BestWay rasmiy imtihon va o'quv ilovasini Windows, macOS, Linux va Android smartfoningizga bepul yuklab oling. Kiosk rejim, avtosaqlash va Subway Vocab Runner o'yini.";

  return {
    title,
    description,
    keywords: [
      "bestway download",
      "bestway yuklab olish",
      "bestway app",
      "bestway apk",
      "bestway android",
      "bestway windows setup",
      "bestway desktop",
    ],
    alternates: {
      canonical: isEn ? "https://bestwayec.uz/en/download" : "https://bestwayec.uz/download",
      languages: {
        uz: "https://bestwayec.uz/download",
        en: "https://bestwayec.uz/en/download",
      },
    },
    openGraph: {
      title,
      description,
      url: isEn ? "https://bestwayec.uz/en/download" : "https://bestwayec.uz/download",
      siteName: "BestWay Education",
      images: [{ url: "/logo-800.png", width: 800, height: 800, alt: "BestWay App" }],
    },
  };
}

export default DesktopPage;
