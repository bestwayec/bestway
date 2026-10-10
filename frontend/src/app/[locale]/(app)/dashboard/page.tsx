import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { setRequestLocale } from "next-intl/server";
import { getRefreshToken, getSessionRole, getVerifiedSessionRole } from "@/lib/auth";

const AdminDashboard = dynamic(() => import("@/components/dashboard/admin-dashboard").then((m) => m.AdminDashboard), {
  loading: () => <div className="h-64 animate-pulse rounded-[12px] bg-border/40" />,
});
const TeacherDashboard = dynamic(() => import("@/components/dashboard/teacher-dashboard").then((m) => m.TeacherDashboard), {
  loading: () => <div className="h-64 animate-pulse rounded-[12px] bg-border/40" />,
});
const StudentDashboard = dynamic(() => import("@/components/dashboard/student-dashboard").then((m) => m.StudentDashboard), {
  loading: () => <div className="h-64 animate-pulse rounded-[12px] bg-border/40" />,
});
const ParentDashboard = dynamic(() => import("@/components/dashboard/parent-dashboard").then((m) => m.ParentDashboard), {
  loading: () => <div className="h-64 animate-pulse rounded-[12px] bg-border/40" />,
});

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  let role = await getSessionRole();
  if (role === "super_admin") {
    // A signed JWT/cookie can still hold the old role after a backend demotion.
    role = await getVerifiedSessionRole();
    if (!role) {
      const login = getPathname({ locale: locale as Locale, href: "/login" });
      const next = getPathname({ locale: locale as Locale, href: "/dashboard" });
      if (await getRefreshToken()) {
        redirect(`/api/auth/resume?${new URLSearchParams({ next })}`);
      }
      redirect(`${login}?${new URLSearchParams({ next, reauth: "1" })}`);
    }
  }

  switch (role) {
    case "super_admin":
      redirect(getPathname({ locale: locale as Locale, href: "/super-admin" }));
    case "admin":
      return <AdminDashboard />;
    case "teacher":
      return <TeacherDashboard />;
    case "student":
      return <StudentDashboard />;
    case "parent":
      return <ParentDashboard />;
    default:
      return null;
  }
}
