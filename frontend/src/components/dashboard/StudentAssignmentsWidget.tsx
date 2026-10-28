"use client";

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
import { Link } from "@/i18n/navigation";
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
  deadline: string;
  min_pass_percent: number;
  is_submitted: boolean;
  score_percent: number;
  is_passed: boolean;
  is_overdue: boolean;
  status: "passed" | "failed" | "pending" | "overdue";
  completed_at?: string | null;
}

export function StudentAssignmentsWidget() {
  const [assignments, setAssignments] = React.useState<StudentAssignmentItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [joinModalOpen, setJoinModalOpen] = React.useState(false);
  const [inviteCode, setInviteCode] = React.useState("");
  const [isJoining, setIsJoining] = React.useState(false);

  const fetchAssignments = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get<StudentAssignmentItem[]>("/student/my-assignments");
      setAssignments(res || []);
    } catch {
      // Gracefully handle unauthenticated or empty states
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
      toast.error("Taklif kodini kiriting");
      return;
    }

    try {
      setIsJoining(true);
      const res = await apiClient.post<{ cohort_name: string }>("/student/join-cohort", {
        invite_code: code,
      });
      toast.success(`"${res.cohort_name}" guruhiga muvaffaqiyatli a'zo bo'ldingiz! 🎉`);
      setInviteCode("");
      setJoinModalOpen(false);
      fetchAssignments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Taklif kodi noto'g'ri yoki topilmadi";
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
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-fg">O'qituvchidan Vazifalar</h3>
            <p className="text-[11px] text-fg-muted">
              {pendingAssignments.length > 0
                ? `${pendingAssignments.length} ta kutilayotgan topshiriq`
                : "Barcha topshiriqlar bajarilgan"}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setJoinModalOpen(true)}
          className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs gap-1.5 h-8"
        >
          <Plus className="h-3.5 w-3.5" />
          Guruhga qo'shilish
        </Button>
      </div>

      {/* Assignment List */}
      {assignments.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-6 text-center border-dashed border-border/80 bg-surface/40">
          <GraduationCap className="h-8 w-8 text-emerald-400/80 mb-2" />
          <p className="text-xs font-medium text-fg">
            Hozircha siz hech qaysi guruhga a'zo emassiz
          </p>
          <p className="text-[11px] text-fg-muted mt-0.5 max-w-xs">
            O'qituvchingiz bergan 6 xonali taklif kodini kiriting va topshiriqlarni boshlang.
          </p>
          <Button
            size="sm"
            onClick={() => setJoinModalOpen(true)}
            className="mt-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-7 gap-1"
          >
            <Plus className="h-3 w-3" />
            Kodni Kiritish
          </Button>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {assignments.slice(0, 4).map((a) => {
            const deadlineDate = new Date(a.deadline);
            const isSoon = !a.is_submitted && deadlineDate.getTime() - Date.now() < 86400000 * 2;

            let actionUrl = "/en/videos";
            if (a.lesson_order) {
              actionUrl = `/en/videos?lesson=lesson-grammar-${a.lesson_order}`;
            } else if (a.exam_id) {
              actionUrl = `/en/mock/${a.exam_id}`;
            }

            return (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-xl border border-border/70 bg-surface-elevated/50 p-3.5 backdrop-blur-md transition-all hover:border-emerald-500/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-fg">{a.title}</span>
                    {a.status === "passed" && (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] px-1.5 py-0">
                        {a.score_percent}% O'tdi ✓
                      </Badge>
                    )}
                    {a.status === "failed" && (
                      <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] px-1.5 py-0">
                        {a.score_percent}% Qayta topshiring
                      </Badge>
                    )}
                    {a.status === "overdue" && (
                      <Badge className="bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] px-1.5 py-0">
                        Muddati o'tdi ✕
                      </Badge>
                    )}
                    {a.status === "pending" && (
                      <Badge className="bg-sky-500/10 text-sky-400 border border-sky-500/20 text-[10px] px-1.5 py-0">
                        Kutilmoqda ⏳
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-fg-muted">
                    <span>Guruh: {a.cohort_name}</span>
                    <span className="flex items-center gap-1">
                      <Clock
                        className={`h-3 w-3 ${
                          isSoon ? "text-amber-400 animate-pulse" : "text-fg-subtle"
                        }`}
                      />
                      Muddat: {deadlineDate.toLocaleDateString()} {deadlineDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                {/* Direct Action Button */}
                <Link href={actionUrl}>
                  <Button
                    size="sm"
                    className={`text-xs h-7 gap-1 font-medium ${
                      a.is_submitted
                        ? "bg-surface-hover hover:bg-surface text-fg-muted"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    }`}
                  >
                    {a.is_submitted ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        Qayta ko'rish
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 fill-current" />
                        Bajarish
                      </>
                    )}
                  </Button>
                </Link>
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
              <GraduationCap className="h-5 w-5 text-emerald-400" />
              O'quv Guruhiga Qo'shilish
            </DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">
              O'qituvchingiz bergan 6 xonali taklif kodini kiriting (masalan: <span className="font-mono text-emerald-400">BW-7892</span>).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleJoinCohort} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">Guruh Taklif Kodi</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="BW-XXXX"
                maxLength={10}
                className="w-full text-center tracking-widest font-mono text-lg font-bold uppercase rounded-xl border border-emerald-500/40 bg-surface px-4 py-2.5 text-emerald-400 placeholder:text-fg-subtle focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                Bekor qilish
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isJoining}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              >
                {isJoining ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Tekshirilmoqda...
                  </>
                ) : (
                  "Guruhga A'zo Bo'lish"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
