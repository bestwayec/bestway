import { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { VocabRunnerGame } from "@/components/vocabulary/runner/VocabRunnerGame";

export const metadata: Metadata = {
  title: "Subway Vocab Runner | BestWay LMS",
  description: "3D Endless runner o'yini orqali ingliz tili so'z boyligi, noto'g'ri fe'llar va kollokatsiyalarni o'rganing.",
};

export default async function VocabRunnerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="container max-w-6xl mx-auto px-4 py-6">
      <VocabRunnerGame />
    </div>
  );
}
