import { setRequestLocale } from "next-intl/server";
import { BamboozleLobby } from "@/components/bamboozle/BamboozleLobby";

export default async function BamboozlePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <BamboozleLobby />;
}
