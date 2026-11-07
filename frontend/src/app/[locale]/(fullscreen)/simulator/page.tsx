import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { CDLayout } from "@/components/simulator/CDLayout";

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

  // CDLayout loads the server's active exam itself through the authenticated proxy,
  // so signed-in students get their entitled exam and nobody gets a silent substitute.
  return <CDLayout />;
}
