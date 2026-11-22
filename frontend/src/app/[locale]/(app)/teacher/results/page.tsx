import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/feedback";
import { ResultsScreen } from "@/components/workspace/homework-results";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<Skeleton className="h-72" />}>
      <ResultsScreen />
    </Suspense>
  );
}
