import { setRequestLocale } from "next-intl/server";
import { getSessionRole } from "@/lib/auth";
import { ExamTrackPage } from "@/components/exam-track/exam-track-page";

export default async function ExamTrackPageRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const role = await getSessionRole();

  if (role !== "student") {
    // Only students can access this page directly
    // Others will see it in nav but clicking will redirect via middleware/role check
    return null;
  }

  return <ExamTrackPage />;
}