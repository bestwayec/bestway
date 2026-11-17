import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { DesignSystemDemo } from "@/components/dev/design-system-demo";

export const metadata: Metadata = { title: "UI", robots: { index: false, follow: false } };

/** Component gallery (docs/design/DESIGN_SYSTEM.md). Development builds only: 404 in production. */
export default async function DevUiPage({ params }: { params: Promise<{ locale: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return <DesignSystemDemo />;
}
