"use client";

import {
  AlertTriangle,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  GraduationCap,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { StatCard, StatCardSkeleton } from "@/components/dashboard/stat-card";
import { ExamActivityCard } from "@/components/dashboard/exam-activity-card";
import { useMe } from "@/hooks/use-me";
import { useDashboardStats } from "@/hooks/use-dashboard";
import { formatMoney } from "@/lib/utils";

export function AdminDashboard() {
  const t = useTranslations("dashboard");
  const operations = useTranslations("adminClassroomStats");
  const tc = useTranslations("common");
  const tm = useTranslations("months");
  const { data: me } = useMe();
  const stats = useDashboardStats();

  const firstName = me?.user.name.split(" ")[0] ?? "";

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <PageHeader
        title={firstName ? t("greeting", { name: firstName }) : t("greeting", { name: "" })}
      />

      {stats.isError ? (
        <ErrorState
          title={tc("error")}
          description={tc("unknownError")}
          action={
            <Button variant="outline" size="sm" onClick={() => stats.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      ) : stats.isLoading || !stats.data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* Asosiy ko'rsatkichlar */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t("todayAttendance")}
              value={stats.data.today.attendanceRate !== null ? `${stats.data.today.attendanceRate}%` : "—"}
              hint={
                stats.data.today.marked > 0
                  ? `${stats.data.today.present + stats.data.today.late}/${stats.data.today.marked}`
                  : t("notMarkedYet")
              }
              icon={CalendarCheck}
              tone="info"
            />
            <StatCard
              label={t("monthIncome")}
              value={formatMoney(stats.data.month.income)}
              hint={`${tm(String(stats.data.month.month))} · ${stats.data.month.paidCount} ${tc("students").toLowerCase()}`}
              icon={Wallet}
              tone="success"
            />
            <StatCard
              label={t("totalStudents")}
              value={stats.data.students}
              hint={`${stats.data.approvedStudents} ${t("approvedStudents").toLowerCase()}`}
              icon={Users}
              tone="brand"
            />
            <StatCard
              label={t("debtors")}
              value={stats.data.month.debtors}
              icon={AlertTriangle}
              tone={stats.data.month.debtors > 0 ? "danger" : "neutral"}
            />
          </div>

          {/* Imtihon tahlili — combo chart (full width) */}
          <div className="mt-4">
            <ExamActivityCard />
          </div>

          {/* Yon ko'rsatkichlar */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label={operations("activeGroups")} value={stats.data.activeGroups} icon={BookOpen} />
            <StatCard label={operations("activeStudents")} value={stats.data.activeStudents} icon={Users} />
            <StatCard label={operations("noGroup")} value={stats.data.studentsWithoutGroups} icon={Users} />
            <StatCard label={operations("assignments")} value={stats.data.classroomExams.assignments} icon={BookOpen} />
            <StatCard label={operations("submitted")} value={stats.data.classroomExams.submitted} icon={ClipboardCheck} />
            <StatCard label={operations("finalized")} value={stats.data.classroomExams.finalized} icon={ClipboardCheck} />
            <StatCard label={operations("pendingReview")} value={stats.data.classroomExams.pendingReview} icon={ClipboardCheck} />
            <StatCard label={t("teachers")} value={stats.data.teachers} icon={GraduationCap} />
            {stats.data.queue.grading > 0 && (
              <StatCard
                label={t("gradingQueue")}
                value={stats.data.queue.grading}
                icon={ClipboardCheck}
                tone="warning"
              />
            )}
          </div>

          {/* Tezkor amallar */}
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t("quickActions")}</h2>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/attendance">
                  <CalendarCheck />
                  {t("markAttendance")}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/payments">
                  <Wallet />
                  {t("paymentPanel")}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/students">
                  <Users />
                  {t("addStudent")}
                </Link>
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
