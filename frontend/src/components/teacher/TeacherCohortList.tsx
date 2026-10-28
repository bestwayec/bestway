"use client";

import * as React from "react";
import {
  BookOpen,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Copy,
  GraduationCap,
  Loader2,
  Plus,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";

export interface CohortListItem {
  id: string;
  name: string;
  description: string;
  invite_code: string;
  teacher_id: string;
  teacher_name: string;
  student_count: number;
  assignment_count: number;
  created_at: string;
}

interface TeacherCohortListProps {
  cohorts: CohortListItem[];
  selectedCohortId: string | null;
  onSelectCohort: (cohortId: string) => void;
  onCohortCreated: () => void;
}

export function TeacherCohortList({
  cohorts,
  selectedCohortId,
  onSelectCohort,
  onCohortCreated,
}: TeacherCohortListProps) {
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleCopyCode = async (code: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      toast.success(`"${code}" taklif kodi nusxalandi!`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Nusxalashda xatolik");
    }
  };

  const handleCreateCohort = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Guruh nomini kiriting");
      return;
    }

    try {
      setIsSubmitting(true);
      await apiClient.post("/teacher/cohorts", {
        name: name.trim(),
        description: description.trim(),
      });
      toast.success("Yangi guruh ochildi!");
      setName("");
      setDescription("");
      setCreateModalOpen(false);
      onCohortCreated();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Xatolik yuz berdi";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with New Cohort Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-fg flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-emerald-400" />
          Sizning Guruhlaringiz ({cohorts.length})
        </h3>
        <Button
          size="sm"
          onClick={() => setCreateModalOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5 shadow-sm"
        >
          <Plus className="h-3.5 w-3.5" />
          Yangi Guruh Ochish
        </Button>
      </div>

      {/* Cohorts Grid */}
      {cohorts.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-8 text-center border-dashed border-border/80 bg-surface/50">
          <GraduationCap className="h-10 w-10 text-emerald-400 mb-2 opacity-80" />
          <p className="text-sm font-medium text-fg">Sizda hali guruhlar yo'q</p>
          <p className="text-xs text-fg-muted mt-1 max-w-xs">
            Yangi guruh oching va o'quvchilaringizga taklif kodini ulashib, topshiriqlar bering.
          </p>
          <Button
            size="sm"
            onClick={() => setCreateModalOpen(true)}
            className="mt-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Birinchi Guruhni Ochish
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cohorts.map((cohort) => {
            const isSelected = cohort.id === selectedCohortId;
            const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(
              "https://bestwayec.uz/en/dashboard"
            )}&text=${encodeURIComponent(
              `🎓 BestWay platformasida "${cohort.name}" guruhimiz ochildi! Taklif kodi: ${cohort.invite_code}\nHoziroq kiring va darslarni boshlang!`
            )}`;

            return (
              <div
                key={cohort.id}
                onClick={() => onSelectCohort(cohort.id)}
                className={`group relative cursor-pointer rounded-2xl border p-4 transition-all duration-200 ${
                  isSelected
                    ? "border-emerald-500 bg-surface-elevated shadow-md shadow-emerald-950/20 ring-1 ring-emerald-500/30"
                    : "border-border/70 bg-surface/80 hover:border-emerald-500/40 hover:bg-surface-elevated/70"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-fg group-hover:text-emerald-400 transition-colors">
                      {cohort.name}
                    </h4>
                    {cohort.description && (
                      <p className="text-xs text-fg-muted line-clamp-2">
                        {cohort.description}
                      </p>
                    )}
                  </div>
                  <Badge
                    
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-[11px] px-2 py-0.5 shrink-0"
                  >
                    {cohort.invite_code}
                  </Badge>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-xs text-fg-muted">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-emerald-400" />
                      {cohort.student_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-sky-400" />
                      {cohort.assignment_count} vazifa
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => handleCopyCode(cohort.invite_code, cohort.id, e)}
                      title="Kodni nusxalash"
                      className="p-1.5 rounded-lg border border-border/70 hover:border-emerald-500/40 text-fg-muted hover:text-emerald-400 transition-colors"
                    >
                      {copiedId === cohort.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <a
                      href={telegramShareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Telegramda ulashish"
                      className="p-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Cohort Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-md border border-border/80 bg-surface-elevated/95 p-6 backdrop-blur-xl sm:rounded-2xl">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-lg font-bold text-fg">
              Yangi O'quv Guruhi Ochish
            </DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">
              Guruh uchun nom kiriting. Tizim unikal 6 xonali taklif kodini avtomatik yaratadi.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCohort} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">Guruh Nomi</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Masalan: IELTS Morning 9:00 yoki CEFR B2"
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">Tavsif (ixtiyoriy)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Dars kunlari va maqsadlar haqida qisqacha..."
                rows={3}
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                type="button"
                
                size="sm"
                onClick={() => setCreateModalOpen(false)}
                disabled={isSubmitting}
              >
                Bekor qilish
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Ochilmoqda...
                  </>
                ) : (
                  "Guruhni Ochish"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
