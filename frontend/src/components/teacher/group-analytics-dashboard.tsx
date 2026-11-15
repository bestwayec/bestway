"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  BookOpen,
  CheckCircle,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  PenTool,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/feedback";
import { useGroupAnalytics } from "@/hooks/use-mock";
import { cn } from "@/lib/utils";
import type { GroupAnalyticsStudent, GroupWeakTopic } from "@/lib/types";

interface GroupAnalyticsDashboardProps {
  groupId: string;
  groupName?: string;
  className?: string;
}

type SortField = "averageScore" | "mockAttemptsCount" | "essaysCount" | "attendanceRate" | "name";
type SortOrder = "asc" | "desc";

export function GroupAnalyticsDashboard({
  groupId,
  groupName,
  className,
}: GroupAnalyticsDashboardProps) {
  const { data: analytics, isLoading, refetch } = useGroupAnalytics(groupId);

  const [search, setSearch] = React.useState<string>("");
  const [sortField, setSortField] = React.useState<SortField>("averageScore");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("desc");
  const [downloadingPdf, setDownloadingPdf] = React.useState<boolean>(false);
  const [downloadingCsv, setDownloadingCsv] = React.useState<boolean>(false);

  const students = analytics?.students ?? [];

  // Filter & Sort students
  const filteredStudents = React.useMemo(() => {
    let result = [...students];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) => s.name.toLowerCase().includes(q) || s.phone?.includes(q)
      );
    }

    result.sort((a, b) => {
      const valA: any = a[sortField];
      const valB: any = b[sortField];

      if (typeof valA === "string") {
        return sortOrder === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }

      return sortOrder === "asc" ? valA - valB : valB - valA;
    });

    return result;
  }, [students, search, sortField, sortOrder]);

  const handleToggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      window.open(`/api/backend/v1/groups/${groupId}/report/pdf`, "_blank");
      toast.success("A4 Rasmiy Oylik Hisobot (PDF) generatsiya qilinmoqda...");
    } catch {
      toast.error("PDF yuklab olishda xatolik yuz berdi");
    } finally {
      setTimeout(() => setDownloadingPdf(false), 1500);
    }
  };

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      window.open(`/api/backend/v1/groups/${groupId}/report/excel`, "_blank");
      toast.success("Guruh tahliliy hisoboti (Excel/CSV) yuklab olinmoqda...");
    } catch {
      toast.error("Excel yuklab olishda xatolik yuz berdi");
    } finally {
      setTimeout(() => setDownloadingCsv(false), 1500);
    }
  };

  if (isLoading && !analytics) {
    return (
      <Card className={cn("border-border bg-bg-subtle/90 text-fg shadow-xl", className)}>
        <CardHeader className="pb-3 border-b border-border/80">
          <Skeleton className="h-6 w-52 bg-surface-hover" />
          <Skeleton className="h-4 w-72 bg-surface-hover" />
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-28 w-full bg-surface-hover rounded-xl" />
          <Skeleton className="h-48 w-full bg-surface-hover rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  const weakTopics = analytics?.weakTopicsHeatmap ?? [];

  return (
    <Card className={cn("border-border bg-bg-subtle/95 text-fg shadow-xl overflow-hidden", className)}>
      <CardHeader className="pb-3 border-b border-border/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-fg">
              <GraduationCap className="size-4 text-success" />
              Guruh Monitoringi va Chuqur Tahlili: {analytics?.groupName ?? groupName}
            </CardTitle>
            <CardDescription className="text-xs text-fg-muted">
              Talabalarning o&apos;rtacha ballari, ishlangan testlar va esselar soni, davomat hamda zaif mavzular tahlili
            </CardDescription>
          </div>

          {/* 1-Click B2B Export Buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={downloadingPdf}
              onClick={handleDownloadPdf}
              className="h-8 border border-danger-border bg-danger-bg text-danger hover:bg-danger-bg/80 text-xs font-semibold px-3 shadow-sm transition-all flex items-center gap-1.5"
            >
              <FileText className="size-3.5" />
              <span>{downloadingPdf ? "Tayyorlanmoqda..." : "📄 Oylik Hisobot (PDF)"}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={downloadingCsv}
              onClick={handleDownloadCsv}
              className="h-8 border-brand/40 bg-brand-subtle text-brand-subtle-fg hover:bg-brand hover:text-brand-fg text-xs font-semibold px-3 shadow-sm transition-all flex items-center gap-1.5"
            >
              <FileSpreadsheet className="size-3.5" />
              <span>{downloadingCsv ? "Yuklanmoqda..." : "📊 Excel Yuklab Olish"}</span>
            </Button>
          </div>
        </div>

        {/* Guruh Asosiy Metrikalari Paneli */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3">
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] text-fg-muted flex items-center gap-1">
              <Users className="size-3 text-success" />
              O&apos;quvchilar soni
            </div>
            <div className="text-xl font-bold text-fg mt-1 tabular-nums">
              {analytics?.totalStudents ?? 0} nafar
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] text-fg-muted flex items-center gap-1">
              <Sparkles className="size-3 text-success" />
              Guruh O&apos;rtacha Bali
            </div>
            <div className="text-xl font-bold text-success mt-1 tabular-nums">
              {analytics?.groupAverageScore ? analytics.groupAverageScore.toFixed(1) : "—"}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] text-fg-muted flex items-center gap-1">
              <CheckCircle className="size-3 text-info" />
              O&apos;rtacha Davomat
            </div>
            <div className="text-xl font-bold text-info mt-1 tabular-nums">
              {analytics?.groupAverageAttendance ?? 90}%
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] text-fg-muted flex items-center gap-1">
              <PenTool className="size-3 text-warning" />
              Yozilgan Esselar
            </div>
            <div className="text-xl font-bold text-warning mt-1 tabular-nums">
              {analytics?.totalEssays ?? 0} ta
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-5">
        {/* 1. Guruh Ichidagi Zaif Mavzular Tahlili (Heatmap Diagramma) */}
        {weakTopics.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-fg flex items-center gap-1.5 uppercase tracking-wider">
                <AlertTriangle className="size-3.5 text-warning" />
                Guruhning Umumiy Zaif Mavzulari (Heatmap)
              </h4>
              <span className="text-[10px] text-fg-muted">
                Butun guruh qaysi savol turlarida eng ko&apos;p xatoga yo&apos;l qo&apos;ymoqda
              </span>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-3">
              {weakTopics.map((topic, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border/80 bg-bg-subtle p-3 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-fg truncate">{topic.topic}</span>
                    <Badge
                      variant={topic.groupErrorRate >= 35 ? "danger" : "warning"}
                      className="text-[10px] py-0 px-1.5"
                    >
                      {topic.groupErrorRate}% xatolik
                    </Badge>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        topic.groupErrorRate >= 35 ? "bg-rose-500" : "bg-amber-400"
                      )}
                      style={{ width: `${Math.min(100, topic.groupErrorRate)}%` }}
                    />
                  </div>

                  <p className="text-[10px] text-fg-muted leading-relaxed">
                    💡 <span className="text-fg-muted">Tavsiya:</span> {topic.recommendation}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. O'quvchilar Reyting Jadvali (Qidirish va Saralash bilan) */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Talabani ism yoki telefon bo'yicha qidirish..."
                className="pl-8 h-8 text-xs border-border bg-surface text-fg"
              />
            </div>

            {/* Saralash tugmalari */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
              <span className="text-[11px] text-fg-muted shrink-0">Saralash:</span>
              <button
                type="button"
                onClick={() => handleToggleSort("averageScore")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium border transition-colors flex items-center gap-1 shrink-0",
                  sortField === "averageScore"
                    ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-surface text-fg-muted hover:text-fg"
                )}
              >
                O&apos;rtacha Ball
                <ArrowUpDown className="size-2.5" />
              </button>

              <button
                type="button"
                onClick={() => handleToggleSort("mockAttemptsCount")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium border transition-colors flex items-center gap-1 shrink-0",
                  sortField === "mockAttemptsCount"
                    ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-surface text-fg-muted hover:text-fg"
                )}
              >
                Mock Testlar
                <ArrowUpDown className="size-2.5" />
              </button>

              <button
                type="button"
                onClick={() => handleToggleSort("essaysCount")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium border transition-colors flex items-center gap-1 shrink-0",
                  sortField === "essaysCount"
                    ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-surface text-fg-muted hover:text-fg"
                )}
              >
                Insholar
                <ArrowUpDown className="size-2.5" />
              </button>

              <button
                type="button"
                onClick={() => handleToggleSort("attendanceRate")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium border transition-colors flex items-center gap-1 shrink-0",
                  sortField === "attendanceRate"
                    ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-surface text-fg-muted hover:text-fg"
                )}
              >
                Davomat
                <ArrowUpDown className="size-2.5" />
              </button>
            </div>
          </div>

          {/* O'quvchilar Jadvali */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-fg-muted">
                <thead className="border-b border-border bg-bg-subtle text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    <th className="py-2.5 px-3">O&apos;quvchi</th>
                    <th className="py-2.5 px-3">Davomat</th>
                    <th className="py-2.5 px-3">Mock Testlar</th>
                    <th className="py-2.5 px-3">Insholar</th>
                    <th className="py-2.5 px-3">O&apos;rtacha Ball</th>
                    <th className="py-2.5 px-3">Oxirgi Faollik</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-fg-muted">
                        O&apos;quvchilar topilmadi
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((st, i) => (
                      <tr key={st.studentId} className="hover:bg-surface-hover transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-fg">{st.name}</div>
                          {st.phone && <div className="text-[10px] text-fg-muted">{st.phone}</div>}
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          <span
                            className={cn(
                              st.attendanceRate >= 85
                                ? "text-success font-bold"
                                : st.attendanceRate >= 70
                                ? "text-warning"
                                : "text-danger font-bold"
                            )}
                          >
                            {st.attendanceRate}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-fg">
                          {st.mockAttemptsCount} ta
                        </td>
                        <td className="py-2.5 px-3 font-mono text-fg">
                          {st.essaysCount} ta
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge
                            variant="neutral"
                            className="border-emerald-500/40 bg-emerald-950/30 text-success font-mono text-xs px-2 py-0.5"
                          >
                            {st.scoreLabel || "—"}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-fg-muted">
                          {st.lastActiveAt ? st.lastActiveAt.slice(0, 16) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
