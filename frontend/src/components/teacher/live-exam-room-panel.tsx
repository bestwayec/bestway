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
}: {
  defaultGroupId?: string;
  className?: string;
}) {
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
      toast.error("Avval Mock imtihonni tanlang");
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
      toast.success(`Jonli imtihon xonasi ochildi! PIN: ${created.pin}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Xona yaratishda xatolik yuz berdi");
    }
  }

  async function handleCopyPin(pin: string) {
    try {
      await navigator.clipboard.writeText(pin);
      setCopiedPin(true);
      toast.success("PIN-kod nusxalandi");
      setTimeout(() => setCopiedPin(false), 2000);
    } catch {
      toast.error("Nusxalashda xatolik");
    }
  }

  async function handleCopyInviteLink(pin: string) {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}/mock?pin=${pin}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      toast.success("Imtihon havolasi nusxalandi");
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error("Nusxalashda xatolik");
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
      toast.success("Imtihon natijalari Excel (.xlsx) formatda yuklab olindi!");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Excel yuklab olishda xatolik");
    } finally {
      setDownloadingExcel(false);
    }
  }

  async function handleCloseRoom(roomId: string) {
    try {
      await closeRoom.mutateAsync(roomId);
      toast.success("Imtihon xonasi yopildi");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Xonani yopishda xatolik");
    }
  }

  return (
    <Card className={cn("mb-6 overflow-hidden border-brand/30 shadow-sm", className)}>
      <CardHeader className="border-b border-border bg-bg-subtle/60 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-brand" />
              </span>
              <CardTitle className="text-base font-bold text-fg">
                Live Exam Room &amp; O&apos;qituvchi Jonli Kuzatuv Paneli (PIN Mode)
              </CardTitle>
              <Badge variant={activeRooms.length > 0 ? "success" : "neutral"}>
                {activeRooms.length > 0
                  ? `${activeRooms.length} ta faol xona`
                  : "Faol xona yo'q"}
              </Badge>
            </div>
            <CardDescription className="text-xs text-fg-muted">
              6 xonali PIN-kod orqali guruhga sinxron imtihon (IELTS CDI yoki Multi-Level DTM) boshlang va har bir o&apos;quvchining nechanchi savolda ekanini real vaqtda kuzating.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedRoomId && (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => void monitorQ.refetch()}
                title="Yangilash"
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
              {showCreateForm ? "Yopish" : "Yangi Live Imtihon (PIN) Ochish"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-5">
        {/* 1. Create Live Exam Room Form */}
        {showCreateForm && (
          <form
            onSubmit={(e) => void handleCreateRoom(e)}
            className="rounded-xl border-2 border-brand/40 bg-bg-subtle/60 p-4 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-fg flex items-center gap-2">
                <KeyRound className="size-4 text-brand" />
                Yangi Jonli Imtihon Xonasini Sozlash
              </h4>
              <Badge variant="brand">6 xonali PIN avto-yaratiladi</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">
                  Mock Imtihonni tanlang:
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
                  <option value="">— Imtihonni tanlang —</option>
                  {(examsQ.data ?? []).map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title} ({ex.type === "multilevel" ? "Multi-Level" : "IELTS"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">
                  Guruh (ixtiyoriy):
                </label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-fg"
                >
                  <option value="">Barcha o&apos;quvchilar uchun ochiq</option>
                  {(groupsQ.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">
                  Rasmiy Simulyator Rejimi:
                </label>
                <select
                  value={simulatorMode}
                  onChange={(e) => setSimulatorMode(e.target.value as ExamSimulatorMode)}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs font-bold text-fg"
                >
                  <option value="cdi">IELTS Computer-Delivered (CDI)</option>
                  <option value="dtm">Multi-Level (DTM Split-Screen)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">
                  Vaqt chegarasi (daqiqa):
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
                placeholder="Xona sarlavhasi (masalan: Shanba kungi Mock sinovi)"
                className="h-9 text-xs max-w-md"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowCreateForm(false)}
                >
                  Bekor qilish
                </Button>
                <Button type="submit" size="sm" loading={createRoom.isPending}>
                  <Radio className="size-4 mr-1.5" />
                  Xonani yaratish va PIN olish
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
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-border bg-surface text-fg-muted hover:text-fg",
                )}
              >
                <span className="font-mono font-bold">PIN: {r.pin}</span>
                <span>·</span>
                <span className="truncate max-w-36">{r.title || r.examTitle || "Mock"}</span>
                <Badge variant={r.status === "active" ? "success" : "neutral"} className="text-[10px]">
                  {r.status === "active" ? "Faol" : "Yopilgan"}
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
                    {currentRoom.status === "active" ? "🟢 JONLI XONA FAOL" : "YOPILGAN"}
                  </Badge>
                  <Badge variant="info">
                    {currentRoom.simulatorMode === "dtm"
                      ? "Multi-Level DTM Simulyator"
                      : "IELTS CDI Simulyator"}
                  </Badge>
                  {currentRoom.groupName && (
                    <Badge variant="neutral">{currentRoom.groupName}</Badge>
                  )}
                </div>
                <h4 className="text-base font-bold text-fg">
                  {currentRoom.title || currentRoom.examTitle || "Jonli Mock Imtihon"}
                </h4>
                <p className="text-xs text-fg-muted">
                  O&apos;quvchilar Dashboard yoki Mock sahifasida quyidagi 6 xonali PIN-kodni terib darhol ulanadi:
                </p>
              </div>

              {/* Large 6-digit PIN display */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="rounded-xl border-2 border-brand bg-bg px-4 py-2 text-center shadow-inner">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">
                    IMTIHON PIN-KODI
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
                    {copiedPin ? <Check className="size-3.5 mr-1.5 text-emerald-400" /> : <Copy className="size-3.5 mr-1.5" />}
                    PIN nusxalash
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCopyInviteLink(currentRoom.pin)}
                    className="h-8 text-xs justify-start"
                  >
                    {copiedLink ? <Check className="size-3.5 mr-1.5 text-emerald-400" /> : <Monitor className="size-3.5 mr-1.5" />}
                    Havolani nusxalash
                  </Button>
                </div>
              </div>
            </div>

            {/* Summary Metrics + Excel Export */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral" className="gap-1 py-1 px-2.5">
                  <Users className="size-3.5 text-brand" />
                  Ulangan: <strong>{summary?.totalParticipants ?? participants.length}</strong>
                </Badge>
                <Badge variant="info" className="gap-1 py-1 px-2.5">
                  Jarayonda: <strong>{summary?.inProgressCount ?? participants.filter((p) => p.status === "in_progress").length}</strong>
                </Badge>
                <Badge variant="success" className="gap-1 py-1 px-2.5">
                  Yakunlagan: <strong>{summary?.completedCount ?? participants.filter((p) => p.status === "completed").length}</strong>
                </Badge>
                {summary?.averageBand != null && (
                  <Badge variant="brand" className="gap-1 py-1 px-2.5">
                    O&apos;rtacha Band: <strong>{Number(summary.averageBand).toFixed(1)}</strong>
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={downloadingExcel}
                  onClick={() => void handleDownloadExcel(currentRoom.id, currentRoom.pin)}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Download className="size-4 mr-1.5" />
                  Excel (.xlsx) Natijalarni Yuklab olish
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
                    Xonani yopish
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
                  Hozircha o&apos;quvchilar PIN-kod orqali ulanmadi
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  O&apos;quvchi <strong>{currentRoom.pin}</strong> kodini kiritishi bilan shu yerda uning ismi va yechayotgan savoli jonli ko&apos;rinadi.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-bg-subtle text-[11px] font-bold uppercase text-fg-muted">
                    <tr>
                      <th className="px-3.5 py-2.5">O&apos;quvchi</th>
                      <th className="px-3.5 py-2.5">Joriy Bo&apos;lim va Savol</th>
                      <th className="px-3.5 py-2.5">Jarayon (Ishlangan / Belgilangan)</th>
                      <th className="px-3.5 py-2.5">Anti-Cheat</th>
                      <th className="px-3.5 py-2.5 text-right">Holat / Natija</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {participants.map((p) => {
                      const totalQ = Math.max(1, p.totalQuestions || 40);
                      const pct = Math.min(100, Math.round(((p.answeredCount || 0) / totalQ) * 100));
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
                              <Badge variant="info" className="uppercase">
                                {p.currentSkill || "reading"}
                              </Badge>
                              <span className="font-mono font-bold text-fg">
                                Savol #{p.currentQuestionNumber || 1}/{totalQ}
                              </span>
                            </div>
                          </td>

                          <td className="px-3.5 py-3 min-w-[180px]">
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="font-semibold text-emerald-400">
                                {p.answeredCount || 0} / {totalQ} ishlangan ({pct}%)
                              </span>
                              {(p.flaggedCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-0.5 font-semibold text-amber-400">
                                  <Flag className="size-3 fill-amber-400" />
                                  {p.flaggedCount}
                                </span>
                              )}
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
                              <div
                                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>

                          <td className="px-3.5 py-3">
                            {(p.antiCheatCount ?? 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-400">
                                <ShieldAlert className="size-3.5" />
                                {p.antiCheatCount} ogohlantirish
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                                <ShieldCheck className="size-3.5" />
                                Toza
                              </span>
                            )}
                          </td>

                          <td className="px-3.5 py-3 text-right">
                            {isDone ? (
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <Badge variant="success" className="gap-1">
                                  <CheckCircle2 className="size-3" />
                                  Yakunladi
                                </Badge>
                                {p.bandScore != null && (
                                  <Badge variant="brand">Band {Number(p.bandScore).toFixed(1)}</Badge>
                                )}
                                {p.multilevelScore != null && (
                                  <Badge variant="warning">
                                    {Math.round(p.multilevelScore)}/75 ({p.cefrLevel || "B2"})
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <Badge variant="info">Ishlamoqda…</Badge>
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
          !showCreateForm && (
            <div className="rounded-xl border border-dashed border-border bg-bg-subtle/30 py-6 text-center">
              <p className="text-sm font-semibold text-fg">
                Hozirda ochilgan Live Exam xonasi yo&apos;q
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                Yuqoridagi &ldquo;Yangi Live Imtihon (PIN) Ochish&rdquo; tugmasini bosib 6 xonali PIN-kod yarating.
              </p>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
