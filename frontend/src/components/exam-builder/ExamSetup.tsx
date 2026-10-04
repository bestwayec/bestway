"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, BookOpenText, GraduationCap, Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { useCreateMockExam } from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamType, MockSkill, PracticeLevel } from "@/lib/types";
import { EXAM_TYPES, EXAM_TYPE_LABEL, tx } from "./types";
import { PracticeLevelField } from "./PracticeLevelField";

const ALL_SKILLS: MockSkill[] = ["listening", "reading", "writing", "speaking"];

const TYPE_ICON: Record<MockExamType, typeof BookOpenText> = {
  ielts_academic: GraduationCap,
  ielts_general: BookOpenText,
  multilevel: Languages,
};

const TYPE_HINT: Record<MockExamType, string> = {
  ielts_academic: "Full academic format · bands 0–9",
  ielts_general: "General training format · bands 0–9",
  multilevel: "Level placement · CEFR result (A1–C1)",
};

/**
 * Step 1 of the unified flow: clean exam setup.
 * Creates the exam shell (always a DRAFT) and jumps straight into the builder.
 */
export function ExamSetup() {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const router = useRouter();
  const create = useCreateMockExam();

  const [type, setType] = React.useState<MockExamType>("ielts_academic");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [level, setLevel] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [isFreeForApproved, setIsFreeForApproved] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [starterStructure, setStarterStructure] = React.useState(true);
  const [mode, setMode] = React.useState<"single" | "full">("single");
  const [skills, setSkills] = React.useState<MockSkill[]>(["reading"]);
  const [practiceLevel, setPracticeLevel] = React.useState<PracticeLevel | null>(null);

  function toggleSkill(skill: MockSkill) {
    setSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill],
    );
  }

  function submit() {
    setError(null);
    if (title.trim().length < 3) {
      setError(tx(t, "titleTooShort", "Title must be at least 3 characters."));
      return;
    }
    const priceNum = price === "" ? 0 : Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError(tx(t, "priceInvalid", "Price must be 0 or more."));
      return;
    }
    const full = mode === "full";
    const chosen = full ? ALL_SKILLS : ALL_SKILLS.filter((s) => skills.includes(s));
    if (chosen.length === 0) {
      setError(tx(t, "needOneSkill", "Select at least one skill."));
      return;
    }
    create.mutate(
      {
        type,
        starterStructure,
        profile: full ? "full_mock" : "practice",
        skills: chosen,
        title: title.trim(),
        description: description.trim() || undefined,
        level: level.trim() || undefined,
        practiceLevel: type === "multilevel" && !full ? practiceLevel : null,
        price: priceNum,
        isFreeForApproved,
      },
      {
        onSuccess: (exam) => {
          toast.success(tx(t, "created", "Exam created — now build the content."));
          router.push(`/exam-builder/${exam.id}`);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : tc("unknownError")),
      },
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl px-1 sm:px-0">
      <PageHeader
        title={tx(t, "setupTitle", "Create Exam")}
        description={tx(
          t,
          "setupHint",
          "Start with the basics. The exam is saved as a draft — you publish it when the content is ready.",
        )}
      />

      {error && (
        <div className="mb-4 rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tx(t, "examType", "Exam type")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Exam type">
            {EXAM_TYPES.map((ty) => {
              const Icon = TYPE_ICON[ty];
              const active = type === ty;
              return (
                <button
                  key={ty}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setType(ty)}
                  className={`min-h-[88px] min-w-0 rounded-[10px] border p-4 text-left transition sm:p-3 ${
                    active
                      ? "border-brand bg-brand-subtle"
                      : "border-border bg-surface hover:border-fg-subtle"
                  }`}
                >
                  <Icon className={`size-5 shrink-0 ${active ? "text-brand" : "text-fg-muted"}`} aria-hidden />
                  <p className="mt-1.5 truncate text-sm font-semibold text-fg">{EXAM_TYPE_LABEL[ty]}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{TYPE_HINT[ty]}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{tx(t, "examMode", "Exam mode")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={tx(t, "examMode", "Exam mode")}>
            <button
              key="single"
              type="button"
              role="radio"
              aria-checked={mode === "single"}
              onClick={() => setMode("single")}
              className={`min-h-[72px] min-w-0 rounded-[10px] border p-3 text-left transition ${
                mode === "single"
                  ? "border-brand bg-brand-subtle"
                  : "border-border bg-surface hover:border-fg-subtle"
              }`}
            >
              <p className="truncate text-sm font-semibold text-fg">
                {tx(t, "modeSingle", "Single skill / Practice")}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">
                {tx(t, "modeSingleHint", "Pick 1–4 skills. Only the chosen sections are created and published.")}
              </p>
            </button>
            <button
              key="full"
              type="button"
              role="radio"
              aria-checked={mode === "full"}
              onClick={() => setMode("full")}
              className={`min-h-[72px] min-w-0 rounded-[10px] border p-3 text-left transition ${
                mode === "full"
                  ? "border-brand bg-brand-subtle"
                  : "border-border bg-surface hover:border-fg-subtle"
              }`}
            >
              <p className="truncate text-sm font-semibold text-fg">
                {tx(t, "modeFull", "Full Mock")}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">
                {tx(t, "modeFullHint", "Strict IELTS blueprint: all four skills with full parts and counts.")}
              </p>
            </button>
          </div>
          {mode === "single" && (
            <fieldset>
              <legend className="text-sm font-medium text-fg">
                {tx(t, "chooseSkills", "Choose skills")}
              </legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {ALL_SKILLS.map((s) => {
                  const active = skills.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSkill(s)}
                      className={`min-h-9 rounded-[8px] border px-3 text-sm font-medium capitalize transition ${
                        active
                          ? "border-brand bg-brand-subtle text-fg"
                          : "border-border text-fg-muted hover:border-fg-subtle hover:text-fg"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          {type === "multilevel" && mode === "single" && (
            <PracticeLevelField value={practiceLevel} onChange={setPracticeLevel} />
          )}
        </CardContent>
      </Card>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-brand/30 bg-brand-subtle p-4">
        <input type="checkbox" checked={starterStructure} onChange={(event) => setStarterStructure(event.target.checked)} className="mt-1 accent-[var(--brand)]" />
        <span>
          <span className="block text-sm font-semibold">{t("starterTitle")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t(type === "multilevel" ? "starterMultilevel" : "starterIelts")}</span>
        </span>
      </label>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{tx(t, "basics", "Basics")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label={tx(t, "title", "Title")} htmlFor="eb-title">
            <Input
              id="eb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="IELTS Mock 1 — Academic"
              autoFocus
            />
          </Field>
          <Field label={tx(t, "description", "Description")} htmlFor="eb-desc">
            <Textarea
              id="eb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tx(t, "descriptionHint", "What is this exam for? Shown to students.")}
              className="min-h-20"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx(t, "level", "Level")} htmlFor="eb-level">
              <Input
                id="eb-level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                placeholder="Academic / B1–B2"
              />
            </Field>
            <Field label={tx(t, "price", "Price (0 = free)")} htmlFor="eb-price">
              <Input
                id="eb-price"
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-border p-3">
            <input
              type="checkbox"
              checked={isFreeForApproved}
              onChange={(e) => setIsFreeForApproved(e.target.checked)}
              className="mt-0.5 accent-[var(--color-brand,#89F336)]"
            />
            <span>
              <span className="block text-sm font-medium text-fg">
                {tx(t, "freeApproved", "Free for enrolled students")}
              </span>
              <span className="block text-xs text-fg-muted">
                {tx(t, "freeApprovedHint", "Approved students open it without payment. Others request access manually.")}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/exam-builder" className="w-full sm:w-auto">
          <Button variant="outline" className="min-h-10 w-full justify-center sm:w-auto">
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            {tc("cancel")}
          </Button>
        </Link>
        <Button onClick={submit} loading={create.isPending} className="min-h-10 w-full justify-center sm:w-auto">
          <span className="truncate">{tx(t, "createContinue", "Create & Continue")}</span>
          <ArrowRight className="size-4 shrink-0" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
