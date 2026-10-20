"use client";

import * as React from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { useGroupAttendanceSummary } from "@/hooks/use-mock";
import { cn } from "@/lib/utils";

interface SmartAttendanceDialogProps {
  groupId: string;
  groupName: string;
  students: Array<{ studentId: string; studentName: string; phone?: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SmartAttendanceDialog({
  groupId,
  groupName,
  students,
  open,
  onOpenChange,
  onSuccess,
}: SmartAttendanceDialogProps) {
  // Normalize today's date to strict YYYY-MM-DD ISO format
  const todayStr = React.useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const [selectedDate, setSelectedDate] = React.useState<string>(todayStr);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);

  // Load existing records for this group & date if any
  const { data: summary, refetch } = useGroupAttendanceSummary(groupId, selectedDate, open);

  const [records, setRecords] = React.useState<
    Record<string, { state: "present" | "late" | "absent"; isExcused: boolean }>
  >({});

  // Initialize records from existing server summary or default to present
  React.useEffect(() => {
    if (!open) return;

    const initial: Record<string, { state: "present" | "late" | "absent"; isExcused: boolean }> = {};

    if (summary?.students && summary.students.length > 0) {
      summary.students.forEach((s) => {
        initial[s.studentId] = {
          state: s.state,
          isExcused: Boolean(s.isExcused),
        };
      });
    } else {
      students.forEach((s) => {
        initial[s.studentId] = {
          state: "present",
          isExcused: false,
        };
      });
    }
    setRecords(initial);
  }, [summary, students, selectedDate, open]);

  // Set single student state
  const handleSetState = (studentId: string, state: "present" | "late" | "absent", isExcused = false) => {
    setRecords((prev) => ({
      ...prev,
      [studentId]: {
        state,
        isExcused,
      },
    }));
  };

  // Mark all students present in 1 click
  const handleMarkAllPresent = () => {
    const updated: typeof records = {};
    students.forEach((s) => {
      updated[s.studentId] = {
        state: "present",
        isExcused: false,
      };
    });
    setRecords(updated);
    toast.success("Barcha talabalar 'Keldi' deb belgilandi");
  };

  // Calculate live statistics
  const totalCount = students.length;
  const presentCount = Object.values(records).filter((r) => r.state === "present").length;
  const lateCount = Object.values(records).filter((r) => r.state === "late").length;
  const absentUnexcusedCount = Object.values(records).filter(
    (r) => r.state === "absent" && !r.isExcused
  ).length;
  const absentExcusedCount = Object.values(records).filter(
    (r) => r.state === "absent" && r.isExcused
  ).length;

  const attendancePercent =
    totalCount > 0 ? Math.round(((presentCount + lateCount * 0.8) / totalCount) * 100) : 100;

  // Submit attendance and trigger parent Telegram notifications
  const handleSaveAttendance = async () => {
    setIsSubmitting(true);
    try {
      // Ensure date is strictly formatted YYYY-MM-DD
      let normalizedDate = selectedDate.trim();
      if (normalizedDate.length > 10) {
        normalizedDate = normalizedDate.slice(0, 10);
      }

      // Payload strictly conforming to backend DTO
      const payloadRecords = students.map((s) => {
        const rec = records[s.studentId] || { state: "present", isExcused: false };
        return {
          studentId: s.studentId,
          state: rec.state,
        };
      });

      // Send PUT request to /attendance/bulk (and fallback to POST if needed)
      try {
        await api.put("/attendance/bulk", {
          groupId,
          date: normalizedDate,
          records: payloadRecords,
        });
      } catch (putErr: any) {
        // Fallback to POST in case PUT is blocked
        await api.post("/attendance/bulk", {
          groupId,
          date: normalizedDate,
          records: payloadRecords,
        });
      }

      toast.success("Davomat muvaffaqiyatli saqlandi!", {
        description: `${totalCount} talaba qayd etildi. Kelmagan o'quvchilar ota-onalariga Telegram ogohlantirish yuborildi.`,
      });

      refetch();
      if (onSuccess) onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      const serverMessage =
        err?.message ||
        err?.response?.data?.message ||
        err?.response?.data?.detail ||
        "Davomatni saqlashda xatolik yuz berdi";
      toast.error(serverMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border border-slate-800/80 bg-[#0B0F17]/95 text-slate-100 p-0 overflow-hidden backdrop-blur-2xl rounded-2xl shadow-2xl">
        {/* Header */}
        <DialogHeader className="p-5 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="text-base font-bold flex items-center gap-2 text-white">
                <Users className="size-4 text-emerald-400" />
                Aqlli Davomat (Smart Attendance) — {groupName}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                1-bosishda davomat olish va ota-onalar Telegramiga avtomatlashtirilgan ogohlantirish
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-8 w-36 border-slate-700 bg-slate-900/90 text-xs text-white focus:ring-1 focus:ring-emerald-500 rounded-lg"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllPresent}
                className="h-8 border-emerald-500/30 bg-emerald-950/20 text-xs text-emerald-300 hover:bg-emerald-600 hover:text-white rounded-lg transition-colors"
              >
                <CheckCircle2 className="mr-1.5 size-3.5" />
                Hammasi keldi
              </Button>
            </div>
          </div>

          {/* Real-time Davomat Ko'rsatkichi Kartalari (Summary Cards) */}
          <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-5 gap-2 pt-3 border-t border-slate-800/60">
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-2.5 text-center">
              <div className="text-[10px] text-slate-400 font-medium">Davomat foizi</div>
              <div className="text-base font-bold text-emerald-400 tabular-nums">{attendancePercent}%</div>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-center">
              <div className="text-[10px] text-emerald-400 font-medium">✅ Keldi</div>
              <div className="text-base font-bold text-emerald-400 tabular-nums">{presentCount}</div>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-2.5 text-center">
              <div className="text-[10px] text-amber-400 font-medium">⚠️ Kechikdi</div>
              <div className="text-base font-bold text-amber-400 tabular-nums">{lateCount}</div>
            </div>
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-2.5 text-center">
              <div className="text-[10px] text-rose-400 font-medium">❌ Sababsiz</div>
              <div className="text-base font-bold text-rose-400 tabular-nums">{absentUnexcusedCount}</div>
            </div>
            <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-2.5 text-center">
              <div className="text-[10px] text-sky-400 font-medium">📝 Sababli</div>
              <div className="text-base font-bold text-sky-400 tabular-nums">{absentExcusedCount}</div>
            </div>
          </div>
        </DialogHeader>

        {/* O'quvchilar ro'yxati va 1-bosishli holat tugmalari */}
        <div className="p-4 max-h-[55vh] overflow-y-auto space-y-2">
          {students.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Guruhda hali o&apos;quvchilar mavjud emas.
            </div>
          ) : (
            students.map((st, index) => {
              const rec = records[st.studentId] || { state: "present", isExcused: false };
              const isPresent = rec.state === "present";
              const isLate = rec.state === "late";
              const isAbsentUnexcused = rec.state === "absent" && !rec.isExcused;
              const isAbsentExcused = rec.state === "absent" && rec.isExcused;

              return (
                <div
                  key={st.studentId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800/50 bg-slate-900/40 p-3 hover:border-slate-700/80 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-mono font-bold text-slate-400">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{st.studentName}</p>
                      {st.phone && <p className="text-[11px] text-slate-400 truncate">{st.phone}</p>}
                    </div>
                  </div>

                  {/* 1-bosishli 4 ta holat tugmasi */}
                  <div className="grid grid-cols-4 gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSetState(st.studentId, "present", false)}
                      className={cn(
                        "rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1",
                        isPresent
                          ? "bg-emerald-600 text-white font-medium shadow-md shadow-emerald-900/30 ring-1 ring-emerald-400"
                          : "bg-slate-950/40 text-slate-400 hover:text-slate-200 border border-slate-800/60"
                      )}
                    >
                      <span>✅</span>
                      <span className="hidden sm:inline">Keldi</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetState(st.studentId, "late", false)}
                      className={cn(
                        "rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1",
                        isLate
                          ? "bg-amber-600 text-white font-medium shadow-md shadow-amber-900/30 ring-1 ring-amber-400"
                          : "bg-slate-950/40 text-slate-400 hover:text-slate-200 border border-slate-800/60"
                      )}
                    >
                      <span>⚠️</span>
                      <span className="hidden sm:inline">Kechikdi</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetState(st.studentId, "absent", false)}
                      className={cn(
                        "rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1",
                        isAbsentUnexcused
                          ? "bg-rose-600 text-white font-medium shadow-md shadow-rose-900/30 ring-1 ring-rose-400"
                          : "bg-slate-950/40 text-slate-400 hover:text-slate-200 border border-slate-800/60"
                      )}
                    >
                      <span>❌</span>
                      <span className="hidden sm:inline">Sababsiz</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetState(st.studentId, "absent", true)}
                      className={cn(
                        "rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1",
                        isAbsentExcused
                          ? "bg-sky-600 text-white font-medium shadow-md shadow-sky-900/30 ring-1 ring-sky-400"
                          : "bg-slate-950/40 text-slate-400 hover:text-slate-200 border border-slate-800/60"
                      )}
                    >
                      <span>📝</span>
                      <span className="hidden sm:inline">Sababli</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="p-4 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Send className="size-3.5 text-emerald-400" />
            Kelmagan o&apos;quvchilar ota-onalariga Telegram ogohlantirish yuboriladi
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs text-slate-400 hover:text-white rounded-xl"
            >
              Bekor qilish
            </Button>
            <Button
              size="sm"
              disabled={isSubmitting || students.length === 0}
              onClick={handleSaveAttendance}
              className="bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-semibold rounded-xl px-6 py-2.5 shadow-lg shadow-emerald-950/40 transition-all flex items-center gap-1.5"
            >
              {isSubmitting ? "Saqlanmoqda..." : "Saqlash va Tasdiqlash"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
