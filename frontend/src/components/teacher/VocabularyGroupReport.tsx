"use client";

import * as React from "react";
import {
  AlertTriangle,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Users,
  X,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface VocabularyGroupReportProps {
  setId: string;
  onClose?: () => void;
}

export interface StudentAttemptRow {
  attemptId: string;
  studentId: string;
  studentName: string;
  phone: string;
  score: number;
  totalWords: number;
  percentage: number;
  pointsAwarded: number;
  mode: string;
  wrongCount: number;
  completedAt: string;
}

export interface HardestWordItem {
  wordId: string;
  english: string;
  uzbek: string;
  mistakeCount: number;
}

export interface SetReportData {
  setId: string;
  title: string;
  level: string;
  totalWords: number;
  totalAttempts: number;
  averagePercentage: number;
  roster: StudentAttemptRow[];
  hardestWords: HardestWordItem[];
}

export function VocabularyGroupReport({ setId, onClose }: VocabularyGroupReportProps) {
  const [report, setReport] = React.useState<SetReportData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);

  const fetchReport = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.get<SetReportData>(`/v1/vocabulary/sets/${setId}/report`);
      setReport(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Hisobotni yuklashda xatolik yuz berdi");
    } finally {
      setIsLoading(false);
    }
  }, [setId]);

  React.useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleDownloadExcel = () => {
    setIsExporting(true);
    try {
      const url = `/api/backend/v1/vocabulary/sets/${setId}/export/excel`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lugat_hisobot_${setId.slice(0, 8)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      console.error("Excel export error", err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-foreground">
              {report?.title || "Guruh Lug'at Tahlili"}
            </h2>
            {report && (
              <Badge className="bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                {report.level}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            O'quvchilar natijalari, xatolar tahlili va Excel (.xlsx) eksporti
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={fetchReport}
            disabled={isLoading}
            className="border-border text-foreground"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Yangilash
          </Button>

          <Button
            type="button"
            onClick={handleDownloadExcel}
            disabled={isExporting || isLoading}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-md shadow-emerald-600/20"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            {isExporting ? "Yuklanmoqda..." : "Excel Yuklab Olish (.xlsx)"}
          </Button>

          {onClose && (
            <Button type="button" variant="ghost" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="py-16 text-center text-muted-foreground flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-500" />
          <span>Guruh natijalari tahlil qilinmoqda...</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive border border-destructive/20">
          {errorMsg}
        </div>
      )}

      {!isLoading && report && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Jami So'zlar
              </span>
              <p className="text-2xl font-bold text-foreground mt-1">
                {report.totalWords} ta
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Topshirganlar
              </span>
              <p className="text-2xl font-bold text-foreground mt-1">
                {report.totalAttempts} ta
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                O'rtacha Natija
              </span>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {report.averagePercentage}%
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Format
              </span>
              <p className="text-2xl font-bold text-foreground mt-1 flex items-center gap-1.5">
                <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
                Emerald .XLSX
              </p>
            </div>
          </div>

          {/* Hardest Words Card */}
          {report.hardestWords && report.hardestWords.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm">
                <AlertTriangle className="h-4 w-4" />
                <span>Guruhda Eng Ko'p Xato Qilingan So'zlar (Hardest Words)</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {report.hardestWords.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm"
                  >
                    <span className="font-semibold text-foreground">{item.english}</span>
                    <span className="text-muted-foreground">({item.uzbek})</span>
                    <Badge variant="danger" className="h-5 px-1.5 text-[10px]">
                      {item.mistakeCount} xato
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Student Roster Table */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-500" />
              <span>O'quvchilar Ro'yxati va Baholari</span>
              <Badge variant="neutral" className="text-xs">
                {report.roster.length} ta natija
              </Badge>
            </h3>

            {report.roster.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
                Hozircha ushbu to'plam bo'yicha birorta o'quvchi test topshirmagan.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">#</th>
                      <th className="py-2.5 px-4 font-semibold">O'quvchi Ismi</th>
                      <th className="py-2.5 px-4 font-semibold">To'g'ri / Jami</th>
                      <th className="py-2.5 px-4 font-semibold">Natija (%)</th>
                      <th className="py-2.5 px-4 font-semibold">Mukofot Balli</th>
                      <th className="py-2.5 px-4 font-semibold">Modus</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Topshirilgan Sana</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.roster.map((row, idx) => {
                      const isPerfect = row.percentage === 100;
                      const isGood = row.percentage >= 80 && row.percentage < 100;
                      return (
                        <tr key={row.attemptId} className="hover:bg-muted/50 transition-colors">
                          <td className="py-2.5 px-4 text-muted-foreground font-mono text-xs">{idx + 1}</td>
                          <td className="py-2.5 px-4 font-medium text-foreground">
                            <div>{row.studentName}</div>
                            {row.phone && (
                              <div className="text-[11px] text-muted-foreground font-mono">{row.phone}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs">
                            {row.score} / {row.totalWords}
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`font-semibold ${
                                isPerfect
                                  ? "text-emerald-500 font-bold"
                                  : isGood
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {row.percentage}%
                            </span>
                          </td>
                          <td className="py-2.5 px-4">
                            {row.pointsAwarded > 0 ? (
                              <Badge
                                className={
                                  row.pointsAwarded === 5
                                    ? "bg-amber-500/10 text-amber-500 border border-amber-500/30 font-bold"
                                    : "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                }
                              >
                                +{row.pointsAwarded} ball
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">0 ball</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-muted-foreground uppercase font-mono">
                            {row.mode}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-muted-foreground text-right font-mono">
                            {new Date(row.completedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
