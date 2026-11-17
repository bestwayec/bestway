"use client";

import * as React from "react";
import { Check, ClipboardList, Copy, GraduationCap, Plus, Send, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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

/** Telegram share link for a group invite, in the teacher's site language. */
export function useCohortShareUrl() {
  const t = useTranslations("teacherWorkspace");
  const locale = useLocale();
  return (name: string, code: string) =>
    `https://t.me/share/url?url=${encodeURIComponent(`https://bestwayec.uz${locale === "uz" ? "" : `/${locale}`}/dashboard`)}&text=${encodeURIComponent(t("shareText", { name, code }))}`;
}

export function TeacherCohortList({ cohorts, selectedCohortId, onSelectCohort, onCohortCreated }: TeacherCohortListProps) {
  const t = useTranslations("teacherWorkspace");
  const tc = useTranslations("common");
  const shareUrl = useCohortShareUrl();
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [nameError, setNameError] = React.useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleCopyCode = async (code: string, id: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      toast.success(t("codeCopied", { code }));
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const handleCreateCohort = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t("groupNameRequired"));
      return;
    }
    setNameError(undefined);
    try {
      setIsSubmitting(true);
      await apiClient.post("/teacher/cohorts", { name: name.trim(), description: description.trim() });
      toast.success(t("groupCreated"));
      setName("");
      setDescription("");
      setCreateModalOpen(false);
      onCohortCreated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tc("unknownError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="cohorts-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cohorts-title" className="text-lg font-semibold text-fg">
          {t("groupsTitle", { count: cohorts.length })}
        </h2>
        {cohorts.length > 0 && (
          <Button variant="outline" onClick={() => setCreateModalOpen(true)}>
            <Plus aria-hidden />
            {t("newGroup")}
          </Button>
        )}
      </div>

      {cohorts.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={t("noGroupsTitle")}
          description={t("noGroupsBody")}
          action={
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus aria-hidden />
              {t("firstGroup")}
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cohorts.map((cohort) => {
            const isSelected = cohort.id === selectedCohortId;
            return (
              <li
                key={cohort.id}
                className={cn(
                  "relative rounded-card border bg-surface p-4 transition-[border-color,box-shadow] duration-fast",
                  isSelected ? "border-brand shadow-e1 ring-1 ring-brand/30" : "border-border hover:border-border-strong",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    {/* The whole card selects the group: the button covers it, other controls sit above it. */}
                    <button
                      type="button"
                      onClick={() => onSelectCohort(cohort.id)}
                      aria-pressed={isSelected}
                      className="text-left font-semibold text-fg after:absolute after:inset-0 after:rounded-card hover:text-brand focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-brand"
                    >
                      {cohort.name}
                    </button>
                    {cohort.description && <p className="line-clamp-2 text-sm text-fg-muted">{cohort.description}</p>}
                  </div>
                  <Badge variant="outline" className="shrink-0 font-mono">{cohort.invite_code}</Badge>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm text-fg-muted">
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className="flex items-center gap-1" title={t("statStudents")}>
                      <Users className="size-4 text-fg-subtle" aria-hidden />
                      <span className="sr-only">{t("statStudents")}: </span>{cohort.student_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <ClipboardList className="size-4 text-fg-subtle" aria-hidden />
                      {t("assignmentsCount", { count: cohort.assignment_count })}
                    </span>
                  </div>
                  <div className="relative z-10 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleCopyCode(cohort.invite_code, cohort.id)}
                      aria-label={t("copyCode")}
                      title={t("copyCode")}
                    >
                      {copiedId === cohort.id ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
                    </Button>
                    <a
                      href={shareUrl(cohort.name, cohort.invite_code)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("shareTelegram")}
                      title={t("shareTelegram")}
                      className="inline-flex size-11 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                    >
                      <Send className="size-4" aria-hidden />
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <form onSubmit={handleCreateCohort} noValidate>
            <DialogHeader>
              <DialogTitle>{t("newGroupTitle")}</DialogTitle>
              <DialogDescription>{t("newGroupBody")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-5 py-2">
              <Field label={t("groupName")} htmlFor="cohort-name" error={nameError}>
                <Input id="cohort-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groupNamePlaceholder")} autoComplete="off" />
              </Field>
              <Field label={t("groupDescription")} htmlFor="cohort-description">
                <Textarea id="cohort-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("groupDescriptionPlaceholder")} rows={3} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)} disabled={isSubmitting}>
                {tc("cancel")}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t("createGroup")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
