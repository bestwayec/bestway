"use client";

import * as React from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Flag,
  KeyRound,
  Monitor,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/feedback";
import {
  useCloseLiveExamRoom,
  useCreateLiveExamRoom,
  useLiveExamRoomMonitor,
  useLiveExamRooms,
  useMockExams,
} from "@/hooks/use-mock";
import { useGroups } from "@/hooks/use-groups";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ExamSimulatorMode } from "@/lib/types";

export function LiveExamRoomPanel({
  defaultGroupId,
  className,
  compact = false,
  openCreateSignal = 0,
}: {
  defaultGroupId?: string;
  className?: string;
  /** Ixcham gorizontal panel: faol xona bo'lmasa faqat bitta qator ko'rinadi */
  compact?: boolean;
  /** Qiymat o'zgarganda yaratish formasi ochiladi (tezkor harakatlar uchun) */
  openCreateSignal?: number;
}) {
  const t = useTranslations("liveRoom");
  const roomsQ = useLiveExamRooms(defaultGroupId);
  const examsQ = useMockExams();
  const groupsQ = useGroups();
  const createRoom = useCreateLiveExamRoom();
  const closeRoom = useCloseLiveExamRoom();

  const [showCreateForm, setShowCreateForm] = React.useState(false);
  const [selectedExamId, setSelectedExamId] = React.useState("");
  const [selectedGroupId, setSelectedGroupId] = React.useState(defaultGroupId ?? "");
  const [simulatorMode, setSimulatorMode] = React.useState<ExamSimulatorMode>("cdi");
  const [roomTitle, setRoomTitle] = React.useState("");
  const [durationMinutes, setDurationMinutes] = React.useState("60");
  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);
  const [copiedPin, setCopiedPin] = React.useState(false);
  const [copiedLink, setCopiedLink] = React.useState(false);
  const [downloadingExcel, setDownloadingExcel] = React.useState(false);

  React.useEffect(() => {
    if (openCreateSignal > 0) setShowCreateForm(true);
  }, [openCreateSignal]);

  const rooms = roomsQ.data ?? [];
  const activeRooms = rooms.filter((r) => r.status === "active");

  React.useEffect(() => {
    if (!selectedRoomId && rooms.length > 0) {
      const firstActive = rooms.find((r) => r.status === "active") ?? rooms[0];
      setSelectedRoomId(firstActive.id);
    }
  }, [rooms, selectedRoomId]);

  React.useEffect(() => {
    if (!selectedExamId && examsQ.data && examsQ.data.length > 0) {
      setSelectedExamId(examsQ.data[0].id);
      if (examsQ.data[0].type === "multilevel") {
        setSimulatorMode("dtm");
      }
    }
  }, [examsQ.data, selectedExamId]);

  const monitorQ = useLiveExamRoomMonitor(selectedRoomId, !!selectedRoomId);
  const currentRoom =
    monitorQ.data?.session ?? rooms.find((r) => r.id === selectedRoomId) ?? null;
  const participants = monitorQ.data?.participants ?? [];
  const summary = monitorQ.data?.summary;

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedExamId) {
      toast.error(t("pickExamFirst"));
      return;
    }
    try {
      const created = await createRoom.mutateAsync({
        examId: selectedExamId,
        groupId: selectedGroupId || undefined,
        simulatorMode,
        title: roomTitle.trim() || undefined,
        durationMinutes: Number(durationMinutes) > 0 ? Number(durationMinutes) : undefined,
      });
      setSelectedRoomId(created.id);
      setShowCreateForm(false);
      toast.success(t("roomOpened", { pin: created.pin }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("createError"));
    }
  }

  async function handleCopyPin(pin: string) {
    try {
      await navigator.clipboard.writeText(pin);
      setCopiedPin(true);
      toast.success(t("pinCopied"));
      setTimeout(() => setCopiedPin(false), 2000);
    } catch {
      toast.error(t("copyError"));
    }
  }

  async function handleCopyInviteLink(pin: string) {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}/mock?pin=${pin}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      toast.success(t("linkCopied"));
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error(t("copyError"));
    }
  }

  async function handleDownloadExcel(roomId: string, pin: string) {
    setDownloadingExcel(true);
    try {
      const { blob, filename } = await api.downloadBlob(
        `/mock/live-rooms/${roomId}/export/excel`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `live_exam_${pin}_results.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("excelDownloaded"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("excelError"));
    } finally {
      setDownloadingExcel(false);
    }
  }

  async function handleCloseRoom(roomId: string) {
    try {
      await closeRoom.mutateAsync(roomId);
      toast.success(t("roomClosed"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("closeError"));
    }
  }

  return (
    <Card className={cn(compact ? "overflow-hidden border-brand/30 shadow-sm" : "mb-6 overflow-hidden border-brand/30 shadow-sm", className)}>
      <CardHeader className={cn("bg-bg-subtle/60", compact ? "py-3" : "border-b border-border pb-3")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-brand" />
              </span>
              <CardTitle className="text-base font-bold text-fg">
                {compact ? t("titleCompact") : t("title")}
              </CardTitle>
              <Badge variant={activeRooms.length > 0 ? "success" : "neutral"}>
                {activeRooms.length > 0 ? t("activeRooms", { count: activeRooms.length }) : t("noActiveRooms")}
              </Badge>
            </div>
            {!compact && (
              <CardDescription className="text-xs text-fg-muted">
                {t("description")}
              </CardDescription>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedRoomId && (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => void monitorQ.refetch()}
                title={t("refresh")}
                aria-label={t("refresh")}
              >
                <RefreshCw
                  className={cn("size-3.5", monitorQ.isFetching && "animate-spin")}
                />
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => setShowCreateForm((v) => !v)}
              className="bg-brand font-bold text-brand-fg hover:bg-brand-hover"
            >
              <Plus className="size-4 mr-1" />
              {showCreateForm ? t("close") : compact ? t("newRoomCompact") : t("newRoom")}
            </Button>
          </div>
        </div>
      </CardHeader>

      {(!compact || !!currentRoom || showCreateForm) && (
      <CardContent className="border-t border-border p-4 sm:p-5 space-y-5">
        {/* 1. Create Live Exam Room Form */}
        {showCreateForm && (
          <form
            onSubmit={(e) => void handleCreateRoom(e)}
            className="rounded-xl border-2 border-brand/40 bg-bg-subtle/60 p-4 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-fg flex items-center gap-2">
                <KeyRound className="size-4 text-brand" />
                {t("formTitle")}
              </h4>
              <Badge variant="brand">{t("pinAuto")}</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">
                  {t("examLabel")}
                </label>
                <select
                  value={selectedExamId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedExamId(id);
                    const ex = examsQ.data?.find((x) => x.id === id);
                    if (ex?.type === "multilevel") setSimulatorMode("dtm");
                    else if (ex) setSimulatorMode("cdi");
                  }}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-fg"
                >
                  <option value="">{t("examPlaceholder")}</option>
                  {(examsQ.data ?? []).map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title} ({ex.type === "multilevel" ? "Multi-Level" : "IELTS"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">
                  {t("groupLabel")}
                </label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-fg"
                >
                  <option value="">{t("groupAll")}</option>
                  {(groupsQ.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">
                  {t("simulatorLabel")}
                </label>
                <select
                  value={simulatorMode}
                  onChange={(e) => setSimulatorMode(e.target.value as ExamSimulatorMode)}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs font-bold text-fg"
                >
                  <option value="cdi">{t("simulatorCdi")}</option>
                  <option value="dtm">{t("simulatorDtm")}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">
                  {t("durationLabel")}
                </label>
                <Input
                  type="number"
                  min={10}
                  max={240}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Input
                value={roomTitle}
                onChange={(e) => setRoomTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="h-9 text-xs max-w-md"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowCreateForm(false)}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" size="sm" loading={createRoom.isPending}>
                  <Radio className="size-4 mr-1.5" />
                  {t("create")}
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* Room selector tabs if multiple rooms exist */}
        {rooms.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            {rooms.slice(0, 6).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRoomId(r.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all",
                  selectedRoomId === r.id
                    ? "border-brand bg-brand/15 text-brand-subtle-fg"
                    : "border-border bg-surface text-fg-muted hover:text-fg",
                )}
              >
                <span className="font-mono font-bold">PIN: {r.pin}</span>
                <span>·</span>
                <span className="truncate max-w-36">{r.title || r.examTitle || "Mock"}</span>
                <Badge variant={r.status === "active" ? "success" : "neutral"} className="text-[10px]">
                  {r.status === "active" ? t("statusActive") : t("statusClosed")}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {/* Active Room Banner + Large 6-digit PIN */}
        {currentRoom ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 rounded-2xl border border-brand/30 bg-gradient-to-r from-brand/10 via-surface to-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={currentRoom.status === "active" ? "success" : "neutral"}>
                    {currentRoom.status === "active" ? t("roomLive") : t("statusClosed")}
                  </Badge>
                  <Badge variant="info">
                    {currentRoom.simulatorMode === "dtm" ? t("simulatorDtm") : t("simulatorCdi")}
                  </Badge>
                  {currentRoom.groupName && (
                    <Badge variant="neutral">{currentRoom.groupName}</Badge>
                  )}
                </div>
                <h4 className="text-base font-bold text-fg">
                  {currentRoom.title || currentRoom.examTitle || t("untitled")}
                </h4>
                <p className="text-xs text-fg-muted">
                  {t("joinHint")}
                </p>
              </div>

              {/* Large 6-digit PIN display */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="rounded-xl border-2 border-brand bg-bg px-4 py-2 text-center shadow-inner">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">
                    {t("pinLabel")}
                  </p>
                  <p className="font-mono text-2xl sm:text-3xl font-black tracking-[0.28em] text-brand tabular-nums">
                    {currentRoom.pin}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCopyPin(currentRoom.pin)}
                    className="h-8 text-xs justify-start"
                  >
                    {copiedPin ? <Check className="size-3.5 mr-1.5 text-brand" /> : <Copy className="size-3.5 mr-1.5" />}
                    {t("copyPin")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCopyInviteLink(currentRoom.pin)}
                    className="h-8 text-xs justify-start"
                  >
                    {copiedLink ? <Check className="size-3.5 mr-1.5 text-brand" /> : <Monitor className="size-3.5 mr-1.5" />}
                    {t("copyLink")}
                  </Button>
                </div>
              </div>
            </div>

            {/* Summary Metrics + Excel Export */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral" className="gap-1 py-1 px-2.5">
                  <Users className="size-3.5 text-brand" />
                  {t("joined")} <strong>{summary?.totalParticipants ?? participants.length}</strong>
                </Badge>
                <Badge variant="info" className="gap-1 py-1 px-2.5">
                  {t("inProgress")} <strong>{summary?.inProgressCount ?? participants.filter((p) => p.status === "in_progress").length}</strong>
                </Badge>
                <Badge variant="success" className="gap-1 py-1 px-2.5">
                  {t("finished")} <strong>{summary?.completedCount ?? participants.filter((p) => p.status === "completed").length}</strong>
                </Badge>
                {summary?.averageBand != null && (
                  <Badge variant="brand" className="gap-1 py-1 px-2.5">
                    {t("averageBand")} <strong>{Number(summary.averageBand).toFixed(1)}</strong>
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={downloadingExcel}
                  onClick={() => void handleDownloadExcel(currentRoom.id, currentRoom.pin)}
                  className="bg-brand text-brand-fg hover:bg-brand-hover"
                >
                  <Download className="size-4 mr-1.5" />
                  {t("downloadExcel")}
                </Button>

                {currentRoom.status === "active" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    loading={closeRoom.isPending}
                    onClick={() => void handleCloseRoom(currentRoom.id)}
                  >
                    <Square className="size-3.5 mr-1.5" />
                    {t("closeRoom")}
                  </Button>
                )}
              </div>
            </div>

            {/* Participants Live Monitor Table */}
            {monitorQ.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : participants.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-bg-subtle/30 py-8 text-center">
                <p className="text-sm font-semibold text-fg">
                  {t("noParticipantsTitle")}
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  {t("noParticipantsBody", { pin: currentRoom.pin })}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-bg-subtle text-[11px] font-bold uppercase text-fg-muted">
                    <tr>
                      <th className="px-3.5 py-2.5">{t("colStudent")}</th>
                      <th className="px-3.5 py-2.5">{t("colSection")}</th>
                      <th className="px-3.5 py-2.5">{t("colProgress")}</th>
                      <th className="px-3.5 py-2.5">{t("colLog")}</th>
                      <th className="px-3.5 py-2.5 text-right">{t("colResult")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {participants.map((p) => {
                      // Only what the server reports: no assumed 40 questions, section or question number.
                      const totalQ = p.totalQuestions && p.totalQuestions > 0 ? p.totalQuestions : null;
                      const pct = totalQ ? Math.min(100, Math.round(((p.answeredCount || 0) / totalQ) * 100)) : null;
                      const isDone = p.status === "completed" || p.status === "grading";

                      return (
                        <tr key={p.attemptId || p.studentId} className="hover:bg-surface-hover/60">
                          <td className="px-3.5 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={p.name} size="sm" />
                              <div>
                                <p className="font-bold text-fg">{p.name}</p>
                                {p.phone && <p className="text-[11px] text-fg-muted">{p.phone}</p>}
                              </div>
                            </div>
                          </td>

                          <td className="px-3.5 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {p.currentSkill ? (
                                <Badge variant="info" className="uppercase">{p.currentSkill}</Badge>
                              ) : null}
                              {p.currentQuestionNumber ? (
                                <span className="font-mono font-bold text-fg">
                                  {totalQ ? t("questionOf", { number: p.currentQuestionNumber, total: totalQ }) : t("questionNumber", { number: p.currentQuestionNumber })}
                                </span>
                              ) : !p.currentSkill ? <span className="text-fg-muted">—</span> : null}
                            </div>
                          </td>

                          <td className="px-3.5 py-3 min-w-[180px]">
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="font-semibold text-brand">
                                {totalQ ? t("answeredOf", { answered: p.answeredCount || 0, total: totalQ, percent: pct ?? 0 }) : t("answered", { answered: p.answeredCount || 0 })}
                              </span>
                              {(p.flaggedCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-0.5 font-semibold text-warning">
                                  <Flag className="size-3 fill-warning" />
                                  {p.flaggedCount}
                                </span>
                              )}
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
                              <div
                                className="h-full rounded-full bg-brand transition-all duration-300"
                                style={{ width: `${pct ?? 0}%` }}
                              />
                            </div>
                          </td>

                          <td className="px-3.5 py-3">
                            {(p.antiCheatCount ?? 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-bg px-2.5 py-1 text-[11px] font-semibold text-warning">
                                <ShieldAlert className="size-3.5" aria-hidden />
                                {t("recorded", { count: p.antiCheatCount ?? 0 })}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-brand">
                                <ShieldCheck className="size-3.5" aria-hidden />
                                {t("nothingRecorded")}
                              </span>
                            )}
                          </td>

                          <td className="px-3.5 py-3 text-right">
                            {isDone ? (
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <Badge variant="success" className="gap-1">
                                  <CheckCircle2 className="size-3" />
                                  {p.status === "grading" ? t("statusGrading") : t("statusDone")}
                                </Badge>
                                {p.bandScore != null && (
                                  <Badge variant="brand">Band {Number(p.bandScore).toFixed(1)}</Badge>
                                )}
                                {p.multilevelScore != null && (
                                  <Badge variant="warning">
                                    {Math.round(p.multilevelScore)}/75{p.cefrLevel ? ` (${p.cefrLevel === "BELOW_B1" ? t("belowB1") : p.cefrLevel})` : ""}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <Badge variant="info">{t("working")}</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          !showCreateForm && !compact && (
            <div className="rounded-xl border border-dashed border-border bg-bg-subtle/30 py-6 text-center">
              <p className="text-sm font-semibold text-fg">
                {t("emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {t("emptyBody")}
              </p>
            </div>
          )
        )}
      </CardContent>
      )}
    </Card>
  );
}
