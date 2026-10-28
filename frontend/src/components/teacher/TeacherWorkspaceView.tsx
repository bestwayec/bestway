"use client";

import * as React from "react";
import { BookOpen, CheckCircle, Clock, GraduationCap, Plus, RefreshCw, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { apiClient } from "@/lib/api-client";
import { CohortListItem, TeacherCohortList } from "./TeacherCohortList";
import { CohortDetailData, CohortProgressTable } from "./CohortProgressTable";
import { CreateAssignmentModal } from "./CreateAssignmentModal";

export function TeacherWorkspaceView() {
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
      const msg = err instanceof Error ? err.message : "Guruhlarni yuklashda xatolik";
      toast.error(msg);
    } finally {
      setIsLoadingCohorts(false);
    }
  }, [selectedCohortId]);

  const fetchCohortAnalytics = React.useCallback(async (cohortId: string) => {
    try {
      setIsLoadingDetail(true);
      const res = await apiClient.get<CohortDetailData>(`/teacher/cohorts/${cohortId}/analytics`);
      setCohortDetail(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Tahlilni yuklashda xatolik";
      toast.error(msg);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

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
    <div className="space-y-6">
      {/* Top Banner & Stats */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-surface-elevated/90 via-surface/90 to-surface-muted/80 p-6 backdrop-blur-2xl shadow-xl shadow-black/20">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl"
        />

        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              <GraduationCap className="h-3.5 w-3.5" />
              Teacher Workspace v1.0
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
              O'qituvchi Kabineti
            </h1>
            <p className="text-xs text-fg-muted sm:text-sm max-w-xl">
              O'quv guruhlaringizni boshqaring, 29 ta grammatika darslari va IELTS imtihonlaridan muddatli topshiriqlar bering hamda o'quvchilar natijalarini kuzating.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
            <div className="rounded-2xl border border-border/60 bg-surface/60 p-3 text-center">
              <div className="text-xl font-bold text-emerald-400">{cohorts.length}</div>
              <div className="text-[11px] text-fg-muted">Guruhlar</div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-surface/60 p-3 text-center">
              <div className="text-xl font-bold text-sky-400">{totalStudents}</div>
              <div className="text-[11px] text-fg-muted">O'quvchilar</div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-surface/60 p-3 text-center">
              <div className="text-xl font-bold text-amber-400">{totalAssignments}</div>
              <div className="text-[11px] text-fg-muted">Vazifalar</div>
            </div>
          </div>
        </div>
      </div>

      {/* Cohorts List */}
      <TeacherCohortList
        cohorts={cohorts}
        selectedCohortId={selectedCohortId}
        onSelectCohort={(id) => setSelectedCohortId(id)}
        onCohortCreated={() => fetchCohorts(false)}
      />

      {/* Cohort Progress Matrix */}
      {selectedCohortId && cohortDetail && (
        <div className="mt-8 pt-4 border-t border-border/60">
          <CohortProgressTable
            data={cohortDetail}
            isLoading={isLoadingDetail}
            onOpenCreateAssignment={() => setIsAssignmentModalOpen(true)}
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
