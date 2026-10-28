"use client";

import * as React from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Plus,
  Send,
  Sparkles,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";

export interface CohortAssignmentItem {
  id: string;
  title: string;
  lesson_id?: string | null;
  lesson_title?: string | null;
  exam_id?: string | null;
  exam_title?: string | null;
  deadline: string;
  min_pass_percent: number;
}

export interface StudentProgressRow {
  student_id: string;
  name: string;
  phone?: string;
  email?: string;
  joined_at: string;
  lessons_completed: number;
  total_submissions: number;
  passed_count: number;
  average_score: number;
  submissions: Record<
    string,
    {
      submitted: boolean;
      score_percent: number;
      is_passed: boolean;
      completed_at?: string;
    }
  >;
}

export interface CohortDetailData {
  cohort: {
    id: string;
    name: string;
    invite_code: string;
    description: string;
    teacher_name: string;
  };
  assignments: CohortAssignmentItem[];
  students: StudentProgressRow[];
}

interface CohortProgressTableProps {
  data: CohortDetailData;
  isLoading?: boolean;
  onOpenCreateAssignment: () => void;
}

export function CohortProgressTable({
  data,
  isLoading,
  onOpenCreateAssignment,
}: CohortProgressTableProps) {
  const [copied, setCopied] = React.useState(false);

  const { cohort, assignments, students } = data;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(cohort.invite_code);
      setCopied(true);
      toast.success("Taklif kodi nusxalandi!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nusxalashda xatolik");
    }
  };

  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    "https://bestwayec.uz/en/dashboard"
  )}&text=${encodeURIComponent(
    `🎓 BestWay platformasida "${cohort.name}" guruhimiz ochildi! Taklif kodi: ${cohort.invite_code}\nHoziroq kiring va darslarni boshlang!`
  )}`;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-5">
      {/* Cohort Header Bar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-500/20 bg-surface-elevated/70 p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-fg">
              {cohort.name}
            </h2>
            <Badge
              
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-xs px-2.5 py-0.5"
            >
              Kod: {cohort.invite_code}
            </Badge>
          </div>
          {cohort.description && (
            <p className="text-xs text-fg-muted">{cohort.description}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-fg-subtle pt-1">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-emerald-400" />
              {students.length} ta o'quvchi
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-sky-400" />
              {assignments.length} ta vazifa
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            
            onClick={copyCode}
            className="border-border/70 hover:border-emerald-500/40 text-xs gap-1.5"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Nusxalandi
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Kodni nusxalash
              </>
            )}
          </Button>
          <a
            href={telegramShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
            Telegramda Ulashish
          </a>
          <Button
            size="sm"
            onClick={onOpenCreateAssignment}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs gap-1.5 shadow-sm shadow-emerald-900/30"
          >
            <Plus className="h-3.5 w-3.5" />
            Yangi Vazifa Biriktirish
          </Button>
        </div>
      </div>

      {/* Analytics Matrix Table */}
      {students.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed border-border/80 bg-surface/50">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 mb-3">
            <Users className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-fg">
            Hozircha guruhda o'quvchilar yo'q
          </h3>
          <p className="mt-1 max-w-sm text-xs text-fg-muted">
            O'quvchilaringizga <span className="font-mono text-emerald-400 font-bold">{cohort.invite_code}</span> taklif kodini bering. Ular platformaga kirib guruhga a'zo bo'lishlari mumkin.
          </p>
          <Button
            size="sm"
            
            onClick={copyCode}
            className="mt-4 text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
          >
            <Copy className="h-3.5 w-3.5" />
            Taklif kodini nusxalash
          </Button>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface-elevated/50 shadow-sm backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border/70 bg-surface-muted/40 font-semibold text-fg-muted">
                  <th className="py-3.5 px-4 min-w-[180px]">O'quvchi</th>
                  <th className="py-3.5 px-3 text-center min-w-[90px]">Darslar (29)</th>
                  <th className="py-3.5 px-3 text-center min-w-[90px]">O'rtacha Ball</th>
                  {assignments.map((a) => (
                    <th key={a.id} className="py-3.5 px-3 text-center min-w-[140px]">
                      <div className="truncate font-medium text-fg" title={a.title}>
                        {a.title}
                      </div>
                      <div className="text-[10px] text-fg-subtle font-normal mt-0.5">
                        {new Date(a.deadline).toLocaleDateString()} gacha ({a.min_pass_percent}%)
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-fg">
                {students.map((student) => {
                  return (
                    <tr
                      key={student.student_id}
                      className="hover:bg-surface-hover/50 transition-colors"
                    >
                      {/* Student Info */}
                      <td className="py-3 px-4">
                        <div className="font-medium text-fg">{student.name}</div>
                        <div className="text-[11px] text-fg-muted font-mono">
                          {student.phone || student.email || "—"}
                        </div>
                      </td>

                      {/* Completed Video Lessons */}
                      <td className="py-3 px-3 text-center">
                        <span className="font-semibold text-emerald-400">
                          {student.lessons_completed}
                        </span>
                        <span className="text-[10px] text-fg-muted"> / 29</span>
                      </td>

                      {/* Average Score */}
                      <td className="py-3 px-3 text-center">
                        {student.total_submissions > 0 ? (
                          <span
                            className={`font-bold ${
                              student.average_score >= 80
                                ? "text-emerald-400"
                                : student.average_score >= 60
                                ? "text-amber-400"
                                : "text-rose-400"
                            }`}
                          >
                            {student.average_score}%
                          </span>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>

                      {/* Submissions by assignment */}
                      {assignments.map((a) => {
                        const sub = student.submissions[a.id];
                        const deadlineDate = new Date(a.deadline);
                        const isOverdue = !sub && deadlineDate < now;

                        if (sub && sub.is_passed) {
                          return (
                            <td key={a.id} className="py-3 px-2 text-center">
                              <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[11px] font-mono font-semibold px-2 py-0.5">
                                {sub.score_percent}% ✓
                              </Badge>
                            </td>
                          );
                        }

                        if (sub && !sub.is_passed) {
                          return (
                            <td key={a.id} className="py-3 px-2 text-center">
                              <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[11px] font-mono font-semibold px-2 py-0.5">
                                {sub.score_percent}% ✕
                              </Badge>
                            </td>
                          );
                        }

                        if (isOverdue) {
                          return (
                            <td key={a.id} className="py-3 px-2 text-center">
                              <Badge className="bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-medium px-2 py-0.5">
                                Topshirmadi ✕
                              </Badge>
                            </td>
                          );
                        }

                        return (
                          <td key={a.id} className="py-3 px-2 text-center">
                            <Badge className="bg-sky-500/10 text-sky-400 border border-sky-500/20 text-[10px] font-medium px-2 py-0.5">
                              Kutilmoqda ⏳
                            </Badge>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
