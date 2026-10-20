"use client";

import * as React from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  Flame,
  ListTodo,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/feedback";
import { useStudentStudyPlan, useUpdateStudyPlanTarget } from "@/hooks/use-mock";
import { cn } from "@/lib/utils";

export function AdaptiveStudyPlan({ className }: { className?: string }) {
  const [selectedMonths, setSelectedMonths] = React.useState<number>(3);
  const [examDate, setExamDate] = React.useState<string>("");
  const [isEditingTarget, setIsEditingTarget] = React.useState<boolean>(false);

  const { data: plan, isLoading, refetch } = useStudentStudyPlan(selectedMonths, examDate || undefined);
  const updateTargetMutation = useUpdateStudyPlanTarget();

  React.useEffect(() => {
    if (plan) {
      setSelectedMonths(plan.targetMonths || 3);
      if (plan.targetExamDate) {
        setExamDate(plan.targetExamDate.slice(0, 10));
      }
    }
  }, [plan]);

  const handleSaveTarget = async () => {
    try {
      await updateTargetMutation.mutateAsync({
        targetMonths: selectedMonths,
        targetExamDate: examDate || undefined,
      });
      setIsEditingTarget(false);
      toast.success("O'quv rejasi yangilandi!", {
        description: `Yangi maqsad: ${selectedMonths} oylik yo'l xaritasi va kunlik moslashtirilgan yuklama.`,
      });
      refetch();
    } catch {
      toast.error("Rejani saqlashda xatolik yuz berdi");
    }
  };

  if (isLoading && !plan) {
    return (
      <Card className={cn("border-emerald-500/20 bg-[#0B0F17]/90 text-slate-100 shadow-xl", className)}>
        <CardHeader className="pb-3 border-b border-slate-800/80">
          <Skeleton className="h-6 w-48 bg-slate-800" />
          <Skeleton className="h-4 w-72 bg-slate-800/60" />
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-20 w-full bg-slate-800/40 rounded-xl" />
          <Skeleton className="h-16 w-full bg-slate-800/40 rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  const weeklyPercent = plan?.weeklyProgress?.percent ?? 0;
  const monthlyPercent = plan?.monthlyProgress?.percent ?? 0;

  return (
    <Card className={cn("border-emerald-500/20 bg-[#0B0F17]/95 text-slate-100 shadow-xl overflow-hidden", className)}>
      <CardHeader className="pb-3 border-b border-slate-800/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
              <Compass className="size-4 text-emerald-400" />
              Adaptiv O&apos;quv Rejasi (Smart Roadmap)
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Imtihon muddatiga qarab sun&apos;iy intellekt tomonidan har kuni qayta muvozanatlashtiriluvchi shaxsiy reja
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="neutral"
              className={cn(
                "border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider",
                plan?.intensityLevel === "intensive"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                  : plan?.intensityLevel === "balanced"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-300"
              )}
            >
              <Zap className="mr-1 size-3" />
              {plan?.intensityLabel ?? "Standart"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditingTarget(!isEditingTarget)}
              className="h-7 border-slate-700 bg-slate-900/60 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <Calendar className="mr-1.5 size-3 text-emerald-400" />
              {isEditingTarget ? "Yopish" : "Muddatni sozlash"}
            </Button>
          </div>
        </div>

        {/* Muddat va Imtihon sanasi sozlamasi paneli */}
        {isEditingTarget && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-3">
            <div className="text-xs font-medium text-emerald-300 flex items-center gap-1.5">
              <Sparkles className="size-3.5" />
              Tayyorgarlik davrini va maqsadli imtihon sanasini tanlang:
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[11px] text-slate-400 mb-1 block">O&apos;quv rejasi davomiyligi:</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { m: 1, label: "1 Oy", desc: "Tezlashtirilgan" },
                    { m: 3, label: "3 Oy", desc: "Muvozanatli" },
                    { m: 6, label: "6 Oy", desc: "Poydevor" },
                  ].map((item) => (
                    <button
                      key={item.m}
                      type="button"
                      onClick={() => setSelectedMonths(item.m)}
                      className={cn(
                        "rounded-lg border p-2 text-left transition-all",
                        selectedMonths === item.m
                          ? "border-emerald-400 bg-emerald-500/20 text-white shadow-sm"
                          : "border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700"
                      )}
                    >
                      <div className="text-xs font-bold">{item.label}</div>
                      <div className="text-[10px] text-slate-400">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 mb-1 block">Kutilayotgan imtihon sanasi:</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="h-9 border-slate-700 bg-slate-900 text-xs text-white"
                  />
                  <Button
                    size="sm"
                    disabled={updateTargetMutation.isPending}
                    onClick={handleSaveTarget}
                    className="h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 shrink-0"
                  >
                    {updateTargetMutation.isPending ? "Saqlanmoqda..." : "Saqlash"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* AI Rebalance Ogohlantiruvchi Banner */}
        {plan?.isBehindSchedule && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <AlertTriangle className="size-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-amber-300">AI Dinamik Qayta Muvozanatlash:</p>
              <p className="text-amber-200/90 leading-relaxed">{plan.rebalanceMessage}</p>
            </div>
          </div>
        )}

        {/* 1. Bugungi Dinamik Vazifa & Qolgan Kunlar Metrikasi */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950/80 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                <Flame className="size-3.5 text-emerald-400" />
                Kunlik Maqsad
              </span>
              <span className="text-slate-400">
                Bazaviy: {plan?.baseDailyQuestionsTarget ?? 20} ta
                {plan?.rebalanceAdjustment ? ` (+${plan.rebalanceAdjustment} AI)` : ""}
              </span>
            </div>
            <p className="text-sm font-semibold text-white tracking-tight">
              {plan?.dailyHeadline ?? "📌 Bugun: 20 ta Listening/Reading savoli + 1 ta Task 2 Essay"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-emerald-950/30 to-slate-900/80 p-3.5 flex flex-col justify-between">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Clock className="size-3 text-emerald-400" />
              Imtihongacha:
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-emerald-400 tabular-nums">
                {plan?.daysRemaining ?? 30}
              </span>
              <span className="text-xs text-slate-300 font-medium">kun qoldi</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5">
              Sana: {plan?.targetExamDate?.slice(0, 10) ?? "—"}
            </span>
          </div>
        </div>

        {/* 2. Progress Barlar: Haftalik va Oylik Bajarilish */}
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Haftalik Reja */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium flex items-center gap-1">
                <TrendingUp className="size-3 text-emerald-400" />
                Haftalik reja:
              </span>
              <span className="font-bold text-emerald-400 tabular-nums">{weeklyPercent}%</span>
            </div>
            {/* Progress bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={cn(
                  "h-full transition-all duration-500 rounded-full",
                  weeklyPercent >= 75
                    ? "bg-emerald-500"
                    : weeklyPercent >= 40
                    ? "bg-amber-500"
                    : "bg-rose-500"
                )}
                style={{ width: `${Math.min(100, Math.max(4, weeklyPercent))}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Bajarildi: {plan?.weeklyProgress?.completedQuestions ?? 0} ta</span>
              <span>Reja: {plan?.weeklyProgress?.targetQuestions ?? 120} ta savol</span>
            </div>
          </div>

          {/* Oylik Reja */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium flex items-center gap-1">
                <Calendar className="size-3 text-sky-400" />
                Oylik reja:
              </span>
              <span className="font-bold text-sky-400 tabular-nums">{monthlyPercent}%</span>
            </div>
            {/* Progress bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-sky-500 transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(100, Math.max(4, monthlyPercent))}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Bajarildi: {plan?.monthlyProgress?.completedQuestions ?? 0} ta</span>
              <span>Reja: {plan?.monthlyProgress?.targetQuestions ?? 500} ta savol</span>
            </div>
          </div>
        </div>

        {/* 3. Bugungi Vazifalar Cheklisti */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <ListTodo className="size-3.5 text-emerald-400" />
              Bugungi Vazifalar Ro&apos;yxati
            </span>
            <span className="text-[11px] text-slate-400 font-normal">
              Bajarilgani avtomatik belgilanadi
            </span>
          </div>

          <div className="space-y-1.5">
            {plan?.dailyTasks?.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "flex items-center justify-between rounded-lg border p-2.5 text-xs transition-colors",
                  task.completed
                    ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
                    : "border-slate-800/80 bg-slate-900/40 text-slate-300 hover:border-slate-700"
                )}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2
                    className={cn(
                      "size-4 shrink-0",
                      task.completed ? "text-emerald-400" : "text-slate-600"
                    )}
                  />
                  <span className={cn(task.completed && "line-through opacity-80")}>
                    {task.title}
                  </span>
                </div>
                <Badge
                  variant="neutral"
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 uppercase border",
                    task.completed
                      ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                      : "border-slate-700 text-slate-400 bg-slate-800/50"
                  )}
                >
                  {task.completed ? "Bajarildi" : `${task.count} ta`}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
