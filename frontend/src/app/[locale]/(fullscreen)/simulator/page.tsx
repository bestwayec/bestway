import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { CdExamView } from "@/components/demo/cd-exam-view";
import { getActiveCdExam, getDemoMockExams, getDemoMockExam } from "@/lib/public-api";

export const metadata: Metadata = {
  title: "Multi-Level (CEFR) Mock Test 1 — Computer-Delivered Simulator",
  description: "Official Computer-Delivered Multi-Level CEFR Exam Simulator. Split-screen layout, independent scrolling, timed sections, and live question palette.",
};

export default async function SimulatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  let exam = await getActiveCdExam();
  if (!exam || !exam.sections || exam.sections.length === 0) {
    const demos = await getDemoMockExams();
    if (demos.length > 0) {
      exam = await getDemoMockExam(demos[0].id);
    }
  }

  if (!exam) {
    return (
      <div className="flex min-h-screen w-screen items-center justify-center bg-bg p-4 text-center">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
          <h1 className="text-xl font-bold text-fg">Imtihon faollashtirilmoqda...</h1>
          <p className="mt-2 text-xs text-fg-muted">
            Hozirda faol CD imtihon yuklanmoqda. Iltimos, bir necha soniyadan so&apos;ng sahifani yangilang.
          </p>
        </div>
      </div>
    );
  }

  return <CdExamView exam={exam} />;
}
