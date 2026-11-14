import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDemoTestDetail } from "@/lib/public-api";
import DemoRunner, { type DemoQuestion } from "@/components/demo/demo-runner";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const test = await getDemoTestDetail(id);
  if (!test) return { title: "Demo" };
  return { title: `${test.title} — Demo` };
}

export async function generateStaticParams() {
  // Allow dynamic; we don't pre-generate but provide hook for ISR
  return [];
}

export default async function DemoDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("marketing");
  // Public demo detail: questions without answers. No test or no questions -> no page;
  // nothing is filled in on the client.
  const test = await getDemoTestDetail(id);
  if (!test || !Array.isArray(test.questions) || test.questions.length === 0) notFound();
  const title = test.title;
  const durationMinutes = test.durationMinutes ?? null;
  const questions: DemoQuestion[] = test.questions.map((q) => ({
    id: q.id,
    section: q.section,
    type: q.type,
    prompt: q.prompt,
    options: q.options ?? null,
    maxScore: q.maxScore ?? 1,
    passageText: q.passageText ?? null,
    instructions: q.instructions ?? null,
    audioUrl: q.audioUrl ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href="/demo"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        {t("demoTitle")}
      </Link>

      <div className="mt-6">
        <DemoRunner
          testId={id}
          title={title}
          durationMinutes={durationMinutes}
          questions={questions}
        />
      </div>
    </div>
  );
}
