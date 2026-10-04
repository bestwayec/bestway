"use client";

import * as React from "react";
import { ArrowLeft, Check, Download, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import {
  useDeleteMockAttempt,
  useExtendMockDeadline,
  useForceSubmitMock,
  useGradeMock,
  useReopenMock,
} from "@/hooks/use-mock";
import { useMe } from "@/hooks/use-me";
import type { MockAttemptDetail, MockAttemptQuestion, MockSkill } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AssessmentPanel } from "./assessment-panel";

const media = (path: string) => `/api/backend${path}`;
const MANUAL_SKILLS = new Set<MockSkill>(["writing", "speaking"]);

export function MockResultView({ attempt }: { attempt: MockAttemptDetail }) {
  const t = useTranslations("mock");
  const { data: me } = useMe();
  const role = me?.user.role;
  const isStaff = role === "teacher" || role === "admin" || role === "super_admin";
  const grade = useGradeMock(attempt.id);

  const isIelts = attempt.examType !== "multilevel";
  const completed = attempt.status === "completed";
  // IELTS: Overall Band faqat 4 bo'lim baholangach chiqadi — aks holda Pending.
  const gradedCount = attempt.sections.filter((s) => s.band != null).length;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/mock"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        {t("title")}
      </Link>

      {isStaff && !completed && <AttemptActions attemptId={attempt.id} status={attempt.status} isAdmin={role === "admin" || role === "super_admin"} />}

      {/* Natija sarlavhasi */}
      <Card className="p-6 text-center">
        <p className="text-sm text-fg-muted">
          {attempt.examTitle}
          {isStaff && attempt.studentName ? ` · ${attempt.studentName}` : ""}
        </p>
        <div className="mt-2 flex items-center justify-center">
          <Badge variant={completed ? "success" : "warning"}>{t(`status.${attempt.status}`)}</Badge>
        </div>

        {completed && (
          <div className="mt-4">
            {isIelts ? (
              <>
                <p className="text-xs tracking-wide text-fg-subtle uppercase">{t("overallBand")}</p>
                <p className="bg-gradient-to-br from-brand to-accent bg-clip-text text-5xl font-bold text-transparent tabular-nums">
                  {attempt.overallBand?.toFixed(1) ?? "—"}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs tracking-wide text-fg-subtle uppercase">{attempt.specificationVersion ? 'Estimated Multilevel Result' : t('cefrLevel')}</p>
                {attempt.specificationVersion && <p className="text-4xl font-bold text-brand tabular-nums">{attempt.overallScore ?? '—'} /75</p>}
                <p className="text-5xl font-bold text-brand">{attempt.cefrLevel ?? "—"}</p>
                {attempt.specificationVersion && <p className="mt-2 text-xs text-fg-subtle">{attempt.specificationVersion} · {attempt.scoreMethod} · {attempt.scoreVersion}</p>}
              </>
            )}
          </div>
        )}

        {!completed && isIelts && (
          <div className="mt-4">
            <p className="text-xs tracking-wide text-fg-subtle uppercase">{t("overallBand")}</p>
            <p className="text-3xl font-bold text-fg-muted tabular-nums">{t("overallPending")}</p>
            <p className="mt-1 text-xs text-fg-subtle tabular-nums">
              {t("sectionsGraded", { done: gradedCount, total: attempt.sections.length })}
            </p>
          </div>
        )}

        {/* Bo'lim ballari — IELTS da har doim BAND (xom ball emas); baholanmagan bo'lim Pending */}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {attempt.sections.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-[8px] border border-border bg-bg-subtle px-3 py-2"
            >
              <span className="text-sm font-medium text-fg">{t(`skills.${s.skill}`)}</span>
              <span className="text-sm text-fg-muted tabular-nums">
                {!isIelts && s.standardScore != null ? <span className="font-bold text-brand">{s.standardScore} /75 · {s.score}/{s.max} raw</span> : s.band != null ? (
                  <span className="font-bold text-brand">{isIelts ? s.band.toFixed(1) : s.band}</span>
                ) : isIelts ? (
                  t("awaitingGrade")
                ) : s.score != null && s.max != null ? (
                  `${s.score}/${s.max}`
                ) : (
                  t("awaitingGrade")
                )}
              </span>
            </div>
          ))}
        </div>

        {completed && (
          <a
            href={media(`/mock/attempts/${attempt.id}/certificate`)}
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-[8px] bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <Download className="size-4" />
            {t("certificate")}
          </a>
        )}
      </Card>

      {attempt.status !== "in_progress" && <AssessmentPanel attemptId={attempt.id} isStaff={isStaff} />}

      {/* Savollar tahlili */}
      <div className="mt-6 space-y-4">
        {attempt.sections.map((s) => {
          const canGrade = isStaff && MANUAL_SKILLS.has(s.skill);
          return (
            <div key={s.id}>
              <h2 className="mb-2 text-sm font-semibold text-fg-muted">{t(`skills.${s.skill}`)}</h2>
              <div className="space-y-2">
                {s.groups.flatMap((g) =>
                  g.questions.map((q) => (
                    <ReviewRow
                      key={q.id}
                      q={q}
                      skill={s.skill}
                      attemptId={attempt.id}
                      canGrade={canGrade}
                      grade={grade}
                    />
                  )),
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Xodim urinish boshqaruvi: force-submit / extend / reopen / delete */
function AttemptActions({
  attemptId,
  status,
  isAdmin,
}: {
  attemptId: string;
  status: string;
  isAdmin: boolean;
}) {
  const tc = useTranslations("common");
  const force = useForceSubmitMock(attemptId);
  const extend = useExtendMockDeadline(attemptId);
  const reopen = useReopenMock(attemptId);
  const del = useDeleteMockAttempt();

  function onExtend() {
    const raw = prompt("Extra minutes (1–180):", "15");
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 180) {
      toast.error("1–180");
      return;
    }
    extend.mutate(n, {
      onSuccess: () => toast.success(tc("saved")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  return (
    <Card className="mb-4 flex flex-wrap gap-2 p-3">
      {status === "in_progress" && (
        <>
          <Button size="sm" variant="outline" loading={force.isPending} onClick={() => force.mutate(undefined, { onSuccess: () => toast.success(tc("saved")), onError: () => toast.error(tc("unknownError")) })}>
            Force submit
          </Button>
          <Button size="sm" variant="outline" loading={extend.isPending} onClick={onExtend}>
            + Extend time
          </Button>
        </>
      )}
      {status === "grading" && (
        <Button size="sm" variant="outline" loading={reopen.isPending} onClick={() => reopen.mutate(undefined, { onSuccess: () => toast.success(tc("saved")), onError: () => toast.error(tc("unknownError")) })}>
          Reopen
        </Button>
      )}
      {isAdmin && (
        <Button
          size="sm"
          variant="ghost"
          loading={del.isPending}
          onClick={() => {
            if (!confirm(tc("delete") + "?")) return;
            del.mutate(attemptId, {
              onSuccess: () => toast.success(tc("saved")),
              onError: () => toast.error(tc("unknownError")),
            });
          }}
        >
          <Trash2 className="text-danger" />
          {tc("delete")}
        </Button>
      )}
    </Card>
  );
}

function ReviewRow({  q,
  skill,
  attemptId,
  canGrade,
  grade,
}: {
  q: MockAttemptQuestion;
  skill: MockSkill;
  attemptId: string;
  canGrade: boolean;
  grade: ReturnType<typeof useGradeMock>;
}) {
  const t = useTranslations("mock");
  const auto = q.isCorrect != null;
  const manual = !auto && (q.isGraded || q.score != null);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
            q.isCorrect === true
              ? "bg-success-bg text-success"
              : q.isCorrect === false
                ? "bg-danger-bg text-danger"
                : "bg-brand-subtle text-brand-subtle-fg",
          )}
        >
          {q.isCorrect === true ? (
            <Check className="size-3.5" />
          ) : q.isCorrect === false ? (
            <X className="size-3.5" />
          ) : (
            q.number
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-line text-sm text-fg">{q.prompt}</p>

          {/* Speaking audio */}
          {q.hasAudio && (
            <audio
              controls
              src={media(`/mock/attempts/${attemptId}/answers/${q.id}/audio`)}
              className="mt-2 h-9 w-full max-w-sm"
              preload="none"
            >
              <track kind="captions" />
            </audio>
          )}

          {/* Javob */}
          {q.response && !q.hasAudio && (
            <p className="mt-1.5 text-sm">
              <span className="text-fg-subtle">{t("yourAnswer")}: </span>
              <span className={cn("font-medium", q.isCorrect === false ? "text-danger" : "text-fg")}>
                {q.response}
              </span>
            </p>
          )}

          {/* To'g'ri javob (auto, noto'g'ri bo'lsa) */}
          {q.correctAnswers && q.correctAnswers.length > 0 && q.isCorrect === false && (
            <p className="mt-0.5 text-sm">
              <span className="text-fg-subtle">{t("correctAnswer")}: </span>
              <span className="font-medium text-success">{q.correctAnswers.join(" / ")}</span>
            </p>
          )}

          {/* Manual ball + izoh (o'quvchiga) */}
          {manual && !canGrade && (
            <p className="mt-1 text-sm text-fg-muted tabular-nums">
              {t("score")}: <span className="font-semibold text-fg">{q.score ?? "—"}</span> / {q.points}
            </p>
          )}
          {q.feedback && !canGrade && (
            <p className="mt-1 rounded-[6px] bg-bg-subtle px-2.5 py-1.5 text-sm text-fg-muted">
              {q.feedback}
            </p>
          )}
          {q.rubricScores && !canGrade && (
            <p className="mt-1 text-xs text-fg-subtle tabular-nums">
              {Object.entries(q.rubricScores)
                .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
                .join(" · ")}
            </p>
          )}

          {/* Baholash formasi (xodim) */}
          {canGrade && <GradeForm q={q} skill={skill} grade={grade} />}
        </div>
      </div>
    </Card>
  );
}

const RUBRICS: Record<string, Array<{ key: string; label: string }>> = {
  writing: [
    { key: "ta", label: "Task Achievement" },
    { key: "cc", label: "Coherence & Cohesion" },
    { key: "lr", label: "Lexical Resource" },
    { key: "gra", label: "Grammar Range & Accuracy" },
  ],
  speaking: [
    { key: "fluency", label: "Fluency & Coherence" },
    { key: "lexical", label: "Lexical Resource" },
    { key: "grammar", label: "Grammar Range & Accuracy" },
    { key: "pronunciation", label: "Pronunciation" },
  ],
};

function GradeForm({
  q,
  skill,
  grade,
}: {
  q: MockAttemptQuestion;
  skill: MockSkill;
  grade: ReturnType<typeof useGradeMock>;
}) {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const [score, setScore] = React.useState(q.score != null ? String(q.score) : "");
  const [feedback, setFeedback] = React.useState(q.feedback ?? "");
  const [rubrics, setRubrics] = React.useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(q.rubricScores ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const saving = grade.isPending && grade.variables?.questionId === q.id;
  const rubricDefs = q.guidance ? [] : RUBRICS[skill] ?? [];
  const rubricsComplete =
    rubricDefs.length > 0 &&
    rubricDefs.every(
      (r) => rubrics[r.key] !== undefined && rubrics[r.key] !== "" && !Number.isNaN(Number(rubrics[r.key])),
    );
  const rubricAvg = rubricsComplete
    ? rubricDefs.reduce((s, r) => s + Number(rubrics[r.key]), 0) / rubricDefs.length
    : null;
  const roundedAvg = rubricAvg != null ? Math.round(rubricAvg * 2) / 2 : null;

  function save() {
    const rubricScores: Record<string, number> = {};
    for (const r of rubricDefs) {
      const raw = rubrics[r.key];
      if (raw === undefined || raw === "") continue;
      const v = Number(raw);
      if (Number.isNaN(v) || v < 0 || v > 9 || Math.round(v * 2) !== v * 2) {
        toast.error(`${r.label}: 0–9 (0.5)`);
        return;
      }
      rubricScores[r.key] = v;
    }
    // Ball bo'sh qoldirilsa — 4 ta mezon to'liq bo'lganda backend o'rtachadan hisoblaydi.
    let n: number | undefined;
    if (score.trim() !== "") {
      n = Number(score);
      if (Number.isNaN(n) || n < 0 || n > q.points) {
        toast.error(`${t("score")}: 0–${q.points}`);
        return;
      }
    } else if (!rubricDefs.length || Object.keys(rubricScores).length !== rubricDefs.length) {
      toast.error(t("scoreOrRubrics"));
      return;
    }
    grade.mutate(
      {
        questionId: q.id,
        ...(n !== undefined ? { score: n } : {}),
        feedback: feedback.trim() || undefined,
        rubricScores: Object.keys(rubricScores).length ? rubricScores : undefined,
      },
      {
        onSuccess: () => toast.success(tc("saved")),
        onError: () => toast.error(tc("unknownError")),
      },
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-[8px] border border-border bg-bg-subtle p-3">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-fg-muted">
          {t("score")} (0–{q.points})
        </label>
        <Input
          type="number"
          min={0}
          max={q.points}
          step={0.5}
          value={score}
          onChange={(e) => setScore(e.target.value)}
          className="h-9 w-24"
        />
        {q.isGraded && <Badge variant="success">✓</Badge>}
        {roundedAvg != null && (
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-fg-muted tabular-nums">
            Rubrics avg: {roundedAvg}
            <Button size="sm" variant="outline" onClick={() => setScore(String(roundedAvg))}>
              {t("useRubricAvg")}
            </Button>
          </span>
        )}
      </div>
      {rubricDefs.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rubricDefs.map((r) => (
            <label key={r.key} className="flex items-center gap-2 text-xs text-fg-muted">
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <Input
                type="number"
                min={0}
                max={9}
                step={0.5}
                value={rubrics[r.key] ?? ""}
                onChange={(e) => setRubrics((m) => ({ ...m, [r.key]: e.target.value }))}
                className="h-8 w-20"
                aria-label={r.label}
              />
            </label>
          ))}
        </div>
      )}
      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={t("feedback")}
        className="min-h-16"
      />
      <div className="flex justify-end">
        <Button size="sm" loading={saving} onClick={save}>
          {tc("save")}
        </Button>
      </div>
    </div>
  );
}
