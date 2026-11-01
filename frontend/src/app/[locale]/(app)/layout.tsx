import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AppLayoutShell } from "@/components/app/app-layout-shell";
import { getRefreshToken, getSessionRole } from "@/lib/auth";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Middleware allaqachon tekshiradi, bu ikkilamchi himoya (rol cookie'siz kirilmasin)
  const role = await getSessionRole();
  if (!role) {
    if (await getRefreshToken()) {
      const next = getPathname({ locale: locale as Locale, href: "/dashboard" });
      redirect(`/api/auth/resume?${new URLSearchParams({ next })}`);
    }
    redirect(`${getPathname({ locale: locale as Locale, href: "/login" })}?reauth=1`);
  }

  return <AppLayoutShell role={role}>{children}</AppLayoutShell>;
}
