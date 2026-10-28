import { setRequestLocale } from "next-intl/server";
import { TeacherWorkspaceView } from "@/components/teacher/TeacherWorkspaceView";

export default async function TeacherPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TeacherWorkspaceView />;
}
