"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import {
  AlertCircle,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  GraduationCap,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/feedback";
import { apiClient } from "@/lib/api-client";

export interface StudentAssignmentItem {
  id: string;
  cohort_id: string;
  cohort_name: string;
  teacher_name?: string;
  title: string;
  lesson_id?: string | null;
  lesson_title?: string | null;
  lesson_order?: number | null;
  exam_id?: string | null;
  exam_title?: string | null;
  can_launch_exam?: boolean;
  exam_attempt_id?: string | null;
  vocabulary_set_id?: string | null;
  deadline: string;
  min_pass_percent: number;
  is_submitted: boolean;
  /** null until the server has a real result (exam attempt or teacher grade) */
  score_percent: number | null;
  is_passed: boolean;
  is_overdue: boolean;
  status: "passed" | "failed" | "pending" | "overdue" | "awaiting_review" | "awaiting_result";
  completed_at?: string | null;
}

export function StudentAssignmentsWidget() {
  const tu = useTranslations("uiText");
  const router = useRouter();
  const [openingId, setOpeningId] = React.useState<string | null>(null);

  async function openAssignedExam(assignment: StudentAssignmentItem) {
    setOpeningId(assignment.id);
    try {
      const exam = await apiClient.get<{ id: string }>(`/student/assignments/${encodeURIComponent(assignment.id)}/exam`);
      if (exam.id !== assignment.exam_id) throw new Error("Assignment changed");
      router.push(`/mock/${encodeURIComponent(exam.id)}`);
    } catch {
      toast.error(tu("assignments.examUnavailable"));
      void fetchAssignments();
    } finally {
      setOpeningId(null);
    }
  }

  const [assignments, setAssignments] = React.useState<StudentAssignmentItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [joinModalOpen, setJoinModalOpen] = React.useState(false);
  const [inviteCode, setInviteCode] = React.useState("");
  const [isJoining, setIsJoining] = React.useState(false);

  const fetchAssignments = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadFailed(false);
      const res = await apiClient.get<StudentAssignmentItem[]>("/student/my-assignments");
      if (!Array.isArray(res)) throw new Error("Invalid assignment list");
      setAssignments(res);
    } catch {
      setLoadFailed(true);
      setAssignments([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const handleJoinCohort = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      toast.error(tu("assignments.codeRequired"));
      return;
    }

    try {
      setIsJoining(true);
      const res = await apiClient.post<{ cohort_name: string }>("/student/join-cohort", {
        invite_code: code,
      });
      toast.success(tu("assignments.joined", { name: res.cohort_name }));
      setInviteCode("");
      setJoinModalOpen(false);
      fetchAssignments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : tu("assignments.codeInvalid");
      toast.error(msg);
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-32 w-full rounded-2xl" />;
  }

  // Active / pending assignments first
  const pendingAssignments = assignments.filter((a) => !a.is_submitted);
  const completedAssignments = assignments.filter((a) => a.is_submitted);

  return (
    <div className="space-y-4">
      {/* Widget Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand-subtle-fg">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-fg">{tu("assignments.title")}</h3>
            <p className="text-[11px] text-fg-muted">
              {pendingAssignments.length > 0
                ? tu("assignments.pending", { count: pendingAssignments.length })
                : loadFailed ? null : tu("assignments.allDone")}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setJoinModalOpen(true)}
          className="border-brand/30 text-brand hover:bg-brand-hover/10 text-xs gap-1.5 h-8"
        >
          <Plus className="h-3.5 w-3.5" />
          {tu("assignments.join")}
        </Button>
      </div>

      {/* Assignment List */}
      {loadFailed ? (
        <div role="alert" className="text-sm text-fg-muted">
          {tu("assignments.loadFailed")}{" "}
          <Button variant="ghost" onClick={() => void fetchAssignments()}>{tu("assignments.reload")}</Button>
        </div>
      ) : assignments.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-6 text-center border-dashed border-border/80 bg-surface/40">
          <GraduationCap className="h-8 w-8 text-brand/80 mb-2" />
          <p className="text-xs font-medium text-fg">
            {tu("assignments.noGroup")}
          </p>
          <p className="text-[11px] text-fg-muted mt-0.5 max-w-xs">
            {tu("assignments.noGroupHint")}
          </p>
          <Button
            size="sm"
            onClick={() => setJoinModalOpen(true)}
            className="mt-3 bg-brand hover:bg-brand-hover text-brand-fg text-xs h-7 gap-1"
          >
            <Plus className="h-3 w-3" />
            {tu("assignments.enterCode")}
          </Button>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {assignments.slice(0, 4).map((a) => {
            const deadlineDate = new Date(a.deadline);
            const isSoon = !a.is_submitted && deadlineDate.getTime() - Date.now() < 86400000 * 2;

            let actionUrl = "/videos";
            if (a.vocabulary_set_id) {
              actionUrl = `/vocabulary/assignment/${encodeURIComponent(a.id)}`;
            } else if (a.lesson_order) {
              actionUrl = `/videos?lesson=lesson-grammar-${a.lesson_order}`;
            } else if (a.exam_attempt_id) {
              actionUrl = `/mock/attempt/${encodeURIComponent(a.exam_attempt_id)}`;
            }

            return (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-xl border border-border/70 bg-surface-elevated/50 p-3.5 backdrop-blur-md transition-all hover:border-brand/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-fg">{a.title}</span>
                    {a.status === "passed" && (
                      <Badge className="bg-brand/20 text-brand-subtle-fg border border-brand/30 text-[10px] px-1.5 py-0">
                        {tu("assignments.passed", { percent: a.score_percent ?? 0 })}
                      </Badge>
                    )}
                    {a.status === "failed" && (
                      <Badge className="bg-warning/20 text-warning border border-warning/30 text-[10px] px-1.5 py-0">
                        {tu("assignments.retry", { percent: a.score_percent ?? 0 })}
                      </Badge>
                    )}
                    {a.status === "awaiting_review" && (
                      <span className="text-xs font-semibold text-fg-muted">{tu("assignments.withTeacher")}</span>
                    )}
                    {a.status === "awaiting_result" && (
                      <span className="text-xs font-semibold text-fg-muted">Natija hisoblanmoqda</span>
                    )}
                    {a.status === "overdue" && (
                      <Badge className="bg-danger/20 text-danger border border-danger/30 text-[10px] px-1.5 py-0">
                        {tu("assignments.overdue")}
                      </Badge>
                    )}
                    {a.status === "pending" && (
                      <Badge className="bg-info/10 text-info border border-info/20 text-[10px] px-1.5 py-0">
                        Kutilmoqda ⏳
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-fg-muted">
                    <span>{tu("assignments.group", { name: a.cohort_name })}</span>
                    <span className="flex items-center gap-1">
                      <Clock
                        className={`h-3 w-3 ${
                          isSoon ? "text-warning animate-pulse" : "text-fg-subtle"
                        }`}
                      />
                      Muddat: {deadlineDate.toLocaleDateString()} {deadlineDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                {a.exam_id && (a.can_launch_exam ?? (!a.is_overdue && !a.is_submitted)) ? (
                  <Button size="sm" disabled={openingId !== null} onClick={() => void openAssignedExam(a)}>
                    <Play className="h-3 w-3" />
                    {tu("assignments.start")}
                  </Button>
                ) : (!a.exam_id || a.exam_attempt_id) && (
                  <Button asChild size="sm" variant={a.is_submitted ? "outline" : "primary"}>
                    <Link href={actionUrl}>
                      {a.is_submitted ? <CheckCircle2 className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      {tu(a.is_submitted ? "assignments.review" : "assignments.start")}
                    </Link>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Join Cohort Modal */}
      <Dialog open={joinModalOpen} onOpenChange={setJoinModalOpen}>
        <DialogContent className="max-w-md border border-border/80 bg-surface-elevated/95 p-6 backdrop-blur-xl sm:rounded-2xl">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-lg font-bold text-fg flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-brand" />
              {tu("assignments.dialogTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">
              {tu("assignments.dialogHint")}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleJoinCohort} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">{tu("assignments.codeLabel")}</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="BW-XXXX"
                maxLength={10}
                className="w-full text-center tracking-widest font-mono text-lg font-bold uppercase rounded-xl border border-brand/40 bg-surface px-4 py-2.5 text-brand placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setJoinModalOpen(false)}
                disabled={isJoining}
              >
                {tu("assignments.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isJoining}
                className="bg-brand hover:bg-brand-hover text-brand-fg font-medium"
              >
                {isJoining ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {tu("assignments.checking")}
                  </>
                ) : (
                  tu("assignments.submit")
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
