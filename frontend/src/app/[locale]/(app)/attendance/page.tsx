import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/feedback";
import { AttendancePanel } from "@/components/attendance/attendance-panel";
import { AttendanceScreen } from "@/components/workspace/attendance-sheet";
import { getSessionRole } from "@/lib/auth";

export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  // Teachers take attendance on the one-screen sheet; the monthly grid stays one click away (?view=month) and for the office.
  const sheet = (await getSessionRole()) === "teacher" && query.view !== "month";
  return (
    <Suspense fallback={<Skeleton className="h-72" />}>
      {sheet ? <AttendanceScreen /> : <AttendancePanel />}
    </Suspense>
  );
}
