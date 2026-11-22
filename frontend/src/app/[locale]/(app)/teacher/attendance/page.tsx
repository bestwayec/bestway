import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/feedback";
import { AttendanceScreen } from "@/components/workspace/attendance-sheet";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<Skeleton className="h-72" />}>
      <AttendanceScreen />
    </Suspense>
  );
}
