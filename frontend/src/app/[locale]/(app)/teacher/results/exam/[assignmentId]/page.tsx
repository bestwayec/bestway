import { setRequestLocale } from "next-intl/server";
import { ExamResultCenter } from "@/components/teacher/exam-result-center";

export default async function Page({ params }: { params: Promise<{ locale: string; assignmentId: string }> }) {
  const { locale, assignmentId } = await params;
  setRequestLocale(locale);
  return <ExamResultCenter assignmentId={assignmentId} />;
}
