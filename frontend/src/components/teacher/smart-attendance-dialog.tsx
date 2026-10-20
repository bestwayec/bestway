"use client";

import * as React from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
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
  const todayStr = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedDate, setSelectedDate] = React.useState<string>(todayStr);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);

  // Load existing records for this group & date if any
  const { data: summary, refetch } = useGroupAttendanceSummary(groupId, selectedDate, open);

  const [records, setRecords] = React.useState<Record<string, { state: "present" | "late" | "absent"; isExcused: boolean; note: string }>>({});

  // Initialize records from students or existing attendance
  React.useEffect(() => {
    const initial: Record<string, { state: "present" | "late" | "absent"; isExcused: boolean; note: string }> = {};

    if (summary?.students && summary.students.length > 0) {
      summary.students.forEach((s) => {
        initial[s.studentId] = {
          state: s.state,
          isExcused: s.isExcused,
          note: s.note || "",
        };
      });
    } else {
      students.forEach((s) => {
        initial[s.studentId] = {
          state: "present",
          isExcused: false,
          note: "",
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
        ...(prev[studentId] || { note: "" }),
        state,
        isExcused,
      },
    }));
  };

  // Set all students to present in 1 click
  const handleMarkAllPresent = () => {
    const updated: typeof records = {};
    students.forEach((s) => {
      updated[s.studentId] = {
        state: "present",
        isExcused: false,
        note: records[s.studentId]?.note || "",
      };
    });
    setRecords(updated);
    toast.success("Barcha talabalar 'Keldi' deb belgilandi");
  };

  // Calculate live statistics
  const totalCount = students.length;
  const presentCount = Object.values(records).filter((r) => r.state === "present").length;
  const lateCount = Object.values(records).filter((r) => r.state === "late").length;
  const absentUnexcusedCount = Object.values(records).filter((r) => r.state === "absent" && !r.isExcused).length;
  const absentExcusedCount = Object.values(records).filter((r) => r.state === "absent" && r.isExcused).length;

  const attendancePercent = totalCount > 0 ? Math.round(((presentCount + lateCount * 0.8) / totalCount) * 100) : 100;

  // Submit attendance and trigger parent Telegram notifications
  const handleSaveAttendance = async () => {
    setIsSubmitting(true);
    try {
      const payloadRecords = students.map((s) => {
        const rec = records[s.studentId] || { state: "present", isExcused: false, note: "" };
        return {
          studentId: s.studentId,
          state: rec.state,
          note: rec.isExcused ? `[Sababli] ${rec.note}`.trim() : rec.note,
        };
      });

      await api.post("/attendance/bulk", {
        groupId,
        date: selectedDate,
        records: payloadRecords,
      });

      toast.success("Davomat muvaffaqiyatli saqlandi!", {
        description: `${totalCount} talaba qayd etildi. Kelmagan o'quvchilar ota-onalariga Telegram ogohlantirish yuborildi.`,
      });

      refetch();
      if (onSuccess) onSuccess();
      onOpenChange(false);
    } catch {
      toast.error("Davomatni saqlashda xatolik yuz berdi");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-emerald-500/30 bg-[#0B0F17] text-slate-100 p-0 overflow-hidden">
        <DialogHeader className="p-5 border-b border-slate-800 bg-slate-900/60">
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
                className="h-8 w-36 border-slate-700 bg-slate-900 text-xs text-white"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllPresent}
                className="h-8 border-emerald-500/40 bg-emerald-950/20 text-xs text-emerald-300 hover:bg-emerald-600 hover:text-white"
              >
                <CheckCircle2 className="mr-1 size-3.5" />
                Hammasi keldi
              </Button>
            </div>
          </div>

          {/* Real-time Davomat Ko'rsatkichi Bar */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-800/60">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-center">
              <div className="text-[10px] text-slate-400">Davomat foizi</div>
              <div className="text-base font-bold text-emerald-400">{attendancePercent}%</div>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2 text-center">
              <div className="text-[10px] text-emerald-300">✅ Keldi</div>
              <div className="text-base font-bold text-emerald-400">{presentCount}</div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2 text-center">
              <div className="text-[10px] text-amber-300">⚠️ Kechikdi</div>
              <div className="text-base font-bold text-amber-400">{lateCount}</div>
            </div>
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-2 text-center">
              <div className="text-[10px] text-rose-300">❌ Sababsiz</div>
              <div className="text-base font-bold text-rose-400">{absentUnexcusedCount}</div>
            </div>
            <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-2 text-center">
              <div className="text-[10px] text-sky-300">📝 Sababli</div>
              <div className="text-base font-bold text-sky-400">{absentExcusedCount}</div>
            </div>
          </div>
        </DialogHeader>

        {/* O'quvchilar ro'yxati va 1-bosishli tugmalar */}
        <div className="p-4 max-h-[55vh] overflow-y-auto space-y-2">
          {students.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Guruhda hali o&apos;quvchilar mavjud emas.
            </div>
          ) : (
            students.map((st, index) => {
              const rec = records[st.studentId] || { state: "present", isExcused: false, note: "" };
              const isPresent = rec.state === "present";
              const isLate = rec.state === "late";
              const isAbsentUnexcused = rec.state === "absent" && !rec.isExcused;
              const isAbsentExcused = rec.state === "absent" && rec.isExcused;

              return (
                <div
                  key={st.studentId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3 hover:border-slate-700 transition-colors"
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
                        "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1",
                        isPresent
                          ? "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400"
                          : "bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      )}
                    >
                      <span>✅</span>
                      <span className="hidden sm:inline">Keldi</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetState(st.studentId, "late", false)}
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1",
                        isLate
                          ? "bg-amber-600 text-white shadow-sm ring-1 ring-amber-400"
                          : "bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      )}
                    >
                      <span>⚠️</span>
                      <span className="hidden sm:inline">Kechikdi</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetState(st.studentId, "absent", false)}
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1",
                        isAbsentUnexcused
                          ? "bg-rose-600 text-white shadow-sm ring-1 ring-rose-400"
                          : "bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      )}
                    >
                      <span>❌</span>
                      <span className="hidden sm:inline">Sababsiz</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetState(st.studentId, "absent", true)}
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1",
                        isAbsentExcused
                          ? "bg-sky-600 text-white shadow-sm ring-1 ring-sky-400"
                          : "bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
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

        <DialogFooter className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Send className="size-3.5 text-emerald-400" />
            Kelmagan o&apos;quvchilar ota-onalariga Telegram ogohlantirish yuboriladi
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Bekor qilish
            </Button>
            <Button
              size="sm"
              disabled={isSubmitting || students.length === 0}
              onClick={handleSaveAttendance}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-5 flex items-center gap-1.5"
            >
              {isSubmitting ? "Saqlanmoqda..." : "Saqlash va Tasdiqlash"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
