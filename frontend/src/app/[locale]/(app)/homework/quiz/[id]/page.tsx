import { setRequestLocale } from "next-intl/server";
import { QuizRunner } from "@/components/homework/quiz-runner";

export default async function HomeworkQuizPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <QuizRunner assignmentId={id} />;
}
