"use client";

import * as React from "react";
import { ClipboardList, GraduationCap, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/feedback";
import { StatTile } from "@/components/ui/stat-tile";
import { PageHeader } from "@/components/app/page-header";
import { apiClient } from "@/lib/api-client";
import { CohortListItem, TeacherCohortList } from "./TeacherCohortList";
import { CohortDetailData, CohortProgressTable } from "./CohortProgressTable";
import { CreateAssignmentModal } from "./CreateAssignmentModal";

export function TeacherWorkspaceView() {
  const t = useTranslations("teacherWorkspace");
  const [cohorts, setCohorts] = React.useState<CohortListItem[]>([]);
  const [selectedCohortId, setSelectedCohortId] = React.useState<string | null>(null);
  const [cohortDetail, setCohortDetail] = React.useState<CohortDetailData | null>(null);
  const [isLoadingCohorts, setIsLoadingCohorts] = React.useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = React.useState(false);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = React.useState(false);

  const fetchCohorts = React.useCallback(async (autoSelectFirst = false) => {
    try {
      setIsLoadingCohorts(true);
      const res = await apiClient.get<CohortListItem[]>("/teacher/cohorts");
      setCohorts(res || []);
      if (res && res.length > 0 && (autoSelectFirst || !selectedCohortId)) {
        setSelectedCohortId(res[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("loadGroupsError");
      toast.error(msg);
    } finally {
      setIsLoadingCohorts(false);
    }
  }, [selectedCohortId, t]);

  const fetchCohortAnalytics = React.useCallback(async (cohortId: string) => {
    try {
      setIsLoadingDetail(true);
      const res = await apiClient.get<CohortDetailData>(`/teacher/cohorts/${cohortId}/analytics`);
      setCohortDetail(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("loadAnalyticsError");
      toast.error(msg);
    } finally {
      setIsLoadingDetail(false);
    }
  }, [t]);

  React.useEffect(() => {
    fetchCohorts(true);
  }, []);

  React.useEffect(() => {
    if (selectedCohortId) {
      fetchCohortAnalytics(selectedCohortId);
    } else {
      setCohortDetail(null);
    }
  }, [selectedCohortId, fetchCohortAnalytics]);

  // Aggregate stats
  const totalStudents = cohorts.reduce((acc, c) => acc + (c.student_count || 0), 0);
  const totalAssignments = cohorts.reduce((acc, c) => acc + (c.assignment_count || 0), 0);

  const selectedCohort = cohorts.find((c) => c.id === selectedCohortId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="grid grid-cols-3 gap-3">
        <StatTile label={t("statGroups")} value={cohorts.length} icon={GraduationCap} loading={isLoadingCohorts} />
        <StatTile label={t("statStudents")} value={totalStudents} icon={Users} loading={isLoadingCohorts} />
        <StatTile label={t("statAssignments")} value={totalAssignments} icon={ClipboardList} loading={isLoadingCohorts} />
      </div>

      {isLoadingCohorts && cohorts.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
      <TeacherCohortList
        cohorts={cohorts}
        selectedCohortId={selectedCohortId}
        onSelectCohort={(id) => setSelectedCohortId(id)}
        onCohortCreated={() => fetchCohorts(false)}
      />
      )}

      {/* Cohort Progress Matrix */}
      {selectedCohortId && cohortDetail && (
        <div className="border-t border-border pt-6">
          <CohortProgressTable
            data={cohortDetail}
            isLoading={isLoadingDetail}
            onOpenCreateAssignment={() => setIsAssignmentModalOpen(true)}
            onGraded={() => void fetchCohortAnalytics(selectedCohortId)}
          />
        </div>
      )}

      {/* Create Assignment Modal */}
      {selectedCohort && (
        <CreateAssignmentModal
          open={isAssignmentModalOpen}
          onOpenChange={setIsAssignmentModalOpen}
          cohortId={selectedCohort.id}
          cohortName={selectedCohort.name}
          onCreated={() => {
            fetchCohortAnalytics(selectedCohort.id);
            fetchCohorts(false);
          }}
        />
      )}
    </div>
  );
}
