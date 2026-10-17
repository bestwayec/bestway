import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getRefreshToken, getVerifiedSessionRole } from "@/lib/auth";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

const AdminDashboard = dynamic(() => import("@/components/dashboard/admin-dashboard").then((m) => m.AdminDashboard), {
  loading: () => <div className="h-64 animate-pulse rounded-[12px] bg-border/40" />,
});

export default async function SuperAdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const role = await getVerifiedSessionRole();
  if (!role) {
    const next = getPathname({ locale: locale as Locale, href: "/super-admin" });
    if (await getRefreshToken()) {
      redirect(`/api/auth/resume?${new URLSearchParams({ next })}`);
    }
    const login = getPathname({ locale: locale as Locale, href: "/login" });
    // A stale/forged cookie must not send the user straight back to this page.
    redirect(`${login}?${new URLSearchParams({ next, reauth: "1" })}`);
  }
  if (role !== "super_admin") {
    redirect(getPathname({ locale: locale as Locale, href: "/dashboard" }));
  }
  return <AdminDashboard />;
}
