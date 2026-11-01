import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { CDLayout } from "@/components/simulator/CDLayout";
import { CdExamView } from "@/components/demo/cd-exam-view";
import { getActiveCdExam, getDemoMockExams, getDemoMockExam } from "@/lib/public-api";

export const dynamic = "force-dynamic";

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

  return <CDLayout exam={exam} />;
}
