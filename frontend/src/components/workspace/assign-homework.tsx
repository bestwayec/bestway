"use client";

import * as React from "react";
import { BookA, CheckCircle2, ClipboardList, FileText, GraduationCap, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { ApiError } from "@/lib/api-client";
import {
  defaultDeadline,
  formatDateTime,
  localInputToIso,
  useAssignHomework,
  useHomeworkOptions,
  usePreviewHomework,
  useWorkspaceOverview,
  type AssignResult,
  type HomeworkDraft,
  type HomeworkKind,
  type HomeworkPreview,
} from "@/lib/teacher-workspace";
import { cn } from "@/lib/utils";

const TYPES: { kind: HomeworkKind; icon: React.ElementType }[] = [
  { kind: "quiz", icon: ClipboardList },
  { kind: "vocabulary", icon: BookA },
  { kind: "exam", icon: GraduationCap },
  { kind: "lesson", icon: FileText },
];

const field = "h-11 w-full rounded-field border border-input-border bg-surface px-3 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
const area = "min-h-32 w-full rounded-field border border-input-border bg-surface p-3 font-mono text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="rounded-card border border-border bg-surface p-4">
      <h2 id={`step-${n}`} className="mb-3 flex items-center gap-2 text-base font-semibold text-fg">
        <span className={cn("flex size-7 items-center justify-center rounded-full text-sm font-bold", done ? "bg-success text-white" : "bg-brand text-brand-fg")}>{done ? "✓" : n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function AssignHomework({ embeddedGroupId, onDone }: { embeddedGroupId?: string; onDone?: () => void }) {
  const t = useTranslations("tw");
  const params = useSearchParams();
  const overview = useWorkspaceOverview();
  const groups = React.useMemo(() => overview.data?.groups ?? [], [overview.data]);
  const [groupId, setGroupId] = React.useState<string | undefined>(embeddedGroupId ?? params.get("group") ?? undefined);
  const [done, setDone] = React.useState<AssignResult | null>(null);

  React.useEffect(() => {
    if (!groupId && groups.length === 1) setGroupId(groups[0].id);
  }, [groupId, groups]);

  if (done) {
    return (
      <Card className="mx-auto max-w-xl p-6 text-center" role="status" data-testid="hw-success">
        <CheckCircle2 className="mx-auto size-12 text-success" />
        <p className="mt-3 text-xl font-semibold text-fg">{done.created ? t("hw.successTitle") : t("hw.alreadyTitle")}</p>
        <p className="mt-1 text-sm text-fg-muted">{t("hw.successBody", { title: done.title })}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild><Link href={`/teacher/results?kind=${done.kind}&id=${done.id}`}>{t("hw.seeResults")}</Link></Button>
          <Button variant="outline" onClick={() => { setDone(null); onDone?.(); }}>{t("hw.another")}</Button>
        </div>
      </Card>
    );
  }

  const content = (
    <div className="space-y-4">
      {!embeddedGroupId && (
        <Step n={1} title={t("hw.stepGroup")} done={!!groupId}>
          {overview.isLoading ? <Skeleton className="h-24" /> : groups.length === 0 ? (
            <EmptyState title={t("home.noGroups")} description={t("home.noGroupsHint")} />
          ) : (
            <div role="radiogroup" aria-label={t("hw.stepGroup")} className="grid gap-2 sm:grid-cols-3">
              {groups.map((g) => (
                <button key={g.id} type="button" role="radio" aria-checked={groupId === g.id} onClick={() => setGroupId(g.id)} data-testid="hw-group"
                  className={cn("min-h-16 rounded-control border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    groupId === g.id ? "border-brand bg-brand-subtle" : "border-border-strong bg-surface hover:bg-surface-hover")}>
                  <span className="block font-semibold text-fg">{g.name}</span>
                  <span className="block text-xs text-fg-muted">{t("home.students", { n: g.studentCount })}</span>
                </button>
              ))}
            </div>
          )}
        </Step>
      )}
      {groupId && <HomeworkForm key={groupId} groupId={groupId} numbered={!embeddedGroupId} onAssigned={setDone} />}
    </div>
  );
  if (embeddedGroupId) return content;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("hw.title")} description={t("hw.subtitle")} />
      {content}
    </div>
  );
}

export const VOCABULARY_HOMEWORK_MODES = [
  "mixed", "eng_uzb", "uzb_eng", "spelling", "listen_choose", "listen_type", "fill_blank", "context_meaning", "synonym", "smart_mix",
] as const;
export type VocabularyHomeworkMode = (typeof VOCABULARY_HOMEWORK_MODES)[number];
const MODE_LABEL: Record<VocabularyHomeworkMode, string> = {
  mixed: "mixed", eng_uzb: "engUzb", uzb_eng: "uzbEng", spelling: "spelling", listen_choose: "listenChoose",
  listen_type: "listenType", fill_blank: "fillBlank", context_meaning: "contextMeaning", synonym: "synonym", smart_mix: "smartMix",
};

function HomeworkForm({ groupId, numbered, onAssigned }: { groupId: string; numbered: boolean; onAssigned: (r: AssignResult) => void }) {
  const t = useTranslations("tw");
  const tm = useTranslations("vocabulary.mode");
  const options = useHomeworkOptions(groupId);
  const preview = usePreviewHomework(groupId);
  const assign = useAssignHomework(groupId);
  const [kind, setKind] = React.useState<HomeworkKind | null>(null);
  const [quizMode, setQuizMode] = React.useState<"existing" | "new">("new");
  const [sourceId, setSourceId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [questionsText, setQuestionsText] = React.useState("");
  const [answerKey, setAnswerKey] = React.useState("");
  const [deadline, setDeadline] = React.useState(defaultDeadline());
  const [advanced, setAdvanced] = React.useState(false);
  const [timeLimit, setTimeLimit] = React.useState<string>("");
  const [maxAttempts, setMaxAttempts] = React.useState("1");
  const [minPass, setMinPass] = React.useState("60");
  const [vocabMode, setVocabMode] = React.useState<VocabularyHomeworkMode | "">("");
  const [plan, setPlan] = React.useState<HomeworkPreview | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const opts = options.data;

  const draft = React.useMemo<HomeworkDraft | null>(() => {
    if (!kind) return null;
    const iso = localInputToIso(deadline);
    const base: HomeworkDraft = { type: kind, deadline: iso, title: title.trim() || undefined };
    if (kind === "quiz") {
      const extra = { timeLimitMinutes: timeLimit ? Number(timeLimit) : null, maxAttempts: Number(maxAttempts) || 1 };
      if (quizMode === "existing") return sourceId ? { ...base, ...extra, quizId: sourceId } : null;
      return { ...base, ...extra, newQuiz: { questionsText, answerKey, category: "grammar" } };
    }
    const pass = { minPassPercent: Number(minPass) };
    if (kind === "vocabulary") return sourceId ? { ...base, ...pass, vocabularySetId: sourceId, ...(vocabMode ? { vocabularyMode: vocabMode } : {}) } : null;
    if (kind === "exam") return sourceId ? { ...base, ...pass, examId: sourceId } : null;
    return { ...base, ...pass, lessonId: sourceId || undefined };
  }, [kind, quizMode, sourceId, title, questionsText, answerKey, deadline, timeLimit, maxAttempts, minPass, vocabMode]);

  // Live preview (validated by the server, nothing saved) — no separate confirmation screen.
  const previewMutate = preview.mutate;
  React.useEffect(() => {
    setPlan(null);
    setProblem(null);
    if (!draft) return;
    const id = window.setTimeout(() => {
      previewMutate(draft, {
        onSuccess: (p) => setPlan(p),
        onError: (e) => setProblem(e instanceof ApiError ? e.message : t("common.loadError")),
      });
    }, 500);
    return () => window.clearTimeout(id);
  }, [draft, previewMutate, t]);

  function chooseKind(next: HomeworkKind) {
    setKind(next);
    setSourceId("");
    setTitle("");
    setVocabMode("");
    if (next === "quiz" && opts?.quizzes.length === 0) setQuizMode("new");
  }

  function chooseSource(id: string, label?: string) {
    setSourceId(id);
    if (label && !title) setTitle(label);
  }

  async function onAssign() {
    if (!draft || !plan || assign.isPending) return;
    try {
      const result = await assign.mutateAsync(draft);
      toast.success(result.created ? t("hw.successTitle") : t("hw.alreadyTitle"));
      onAssigned(result);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.saveError"));
    }
  }

  if (options.isLoading || !opts) return <Skeleton className="h-64" />;
  const offset = numbered ? 1 : 0;
  const sourceList = kind === "vocabulary" ? opts.vocabularySets.map((s) => ({ id: s.id, label: s.title, meta: t("hw.words", { n: s.wordCount }) }))
    : kind === "exam" ? opts.exams.map((e) => ({ id: e.id, label: e.title, meta: e.type }))
    : kind === "quiz" ? opts.quizzes.map((q) => ({ id: q.id, label: q.title, meta: t("hw.questions", { n: q.questionCount }) }))
    : opts.lessons.map((l) => ({ id: l.id, label: l.title, meta: "" }));

  return (
    <>
      <Step n={1 + offset} title={t("hw.stepType")} done={!!draft}>
        <p className="mb-3 text-sm text-fg-muted">{t("hw.groupInfo", { name: opts.group.name, n: opts.group.studentCount })}</p>
        <div role="radiogroup" aria-label={t("hw.stepType")} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {TYPES.map(({ kind: k, icon: Icon }) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => chooseKind(k)} data-testid={`hw-type-${k}`}
              className={cn("flex min-h-20 flex-col items-start gap-2 rounded-control border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                kind === k ? "border-brand bg-brand-subtle" : "border-border-strong bg-surface hover:bg-surface-hover")}>
              <Icon className="size-5 text-brand" aria-hidden />
              <span className="text-sm font-semibold leading-tight text-fg">{t(`kind.${k}`)}</span>
            </button>
          ))}
        </div>

        {kind === "quiz" && (
          <div className="mt-4 space-y-3">
            <div role="radiogroup" aria-label={t("hw.quizSource")} className="inline-flex rounded-control border border-border-strong p-1">
              {(["new", "existing"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={quizMode === m} onClick={() => { setQuizMode(m); setSourceId(""); }} disabled={m === "existing" && !opts.quizzes.length}
                  className={cn("min-h-10 rounded-field px-4 text-sm font-medium disabled:opacity-50", quizMode === m ? "bg-brand text-brand-fg" : "text-fg")}>
                  {t(`hw.quiz.${m}`)}
                </button>
              ))}
            </div>
            {quizMode === "new" && (
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm font-medium text-fg">{t("hw.questionsLabel")}
                  <textarea className={area} value={questionsText} onChange={(e) => setQuestionsText(e.target.value)} placeholder={t("hw.questionsPlaceholder")} data-testid="hw-questions" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-fg">{t("hw.keyLabel")}
                  <textarea className={cn(area, "min-h-20")} value={answerKey} onChange={(e) => setAnswerKey(e.target.value)} placeholder={t("hw.keyPlaceholder")} data-testid="hw-key" />
                </label>
              </div>
            )}
          </div>
        )}

        {kind && !(kind === "quiz" && quizMode === "new") && (
          <div className="mt-4">
            {sourceList.length === 0 ? (
              <p className="rounded-control bg-bg-subtle p-3 text-sm text-fg-muted">{t(`hw.empty.${kind}`)}</p>
            ) : (
              <label className="grid gap-1 text-sm font-medium text-fg">{t(`hw.pick.${kind}`)}
                <select className={field} value={sourceId} onChange={(e) => chooseSource(e.target.value, sourceList.find((s) => s.id === e.target.value)?.label)} data-testid="hw-source">
                  <option value="">{kind === "lesson" ? t("hw.noLesson") : t("hw.choose")}</option>
                  {sourceList.map((s) => <option key={s.id} value={s.id}>{s.label}{s.meta ? ` · ${s.meta}` : ""}</option>)}
                </select>
              </label>
            )}
            {kind === "vocabulary" && sourceId && (
              <label className="mt-3 grid gap-1 text-sm font-medium text-fg">{t("hw.questionType")}
                <select className={field} value={vocabMode} onChange={(e) => setVocabMode(e.target.value as VocabularyHomeworkMode | "")} data-testid="hw-vocab-mode">
                  <option value="">{t("hw.learnerChooses")}</option>
                  {VOCABULARY_HOMEWORK_MODES.map((m) => <option key={m} value={m}>{tm(MODE_LABEL[m])}</option>)}
                </select>
                <span className="text-xs font-normal text-fg-muted">{t("hw.questionTypeHint")}</span>
              </label>
            )}
          </div>
        )}
      </Step>

      {kind && (
        <Step n={2 + offset} title={t("hw.stepDeadline")} done={!!plan}>
          <div className="grid gap-3 sm:grid-cols-2">
            {!(kind === "quiz" && quizMode === "existing") && (
              <label className="grid gap-1 text-sm font-medium text-fg sm:col-span-2">{t("hw.titleLabel")}
                <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("hw.titlePlaceholder")} data-testid="hw-title" />
              </label>
            )}
            <label className="grid gap-1 text-sm font-medium text-fg">{t("hw.deadline")}
              <input type="datetime-local" className={field} value={deadline} onChange={(e) => setDeadline(e.target.value)} data-testid="hw-deadline" />
            </label>
          </div>
          <button type="button" className="mt-3 text-sm font-medium text-brand hover:underline" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            {advanced ? t("hw.hideAdvanced") : t("hw.showAdvanced")}
          </button>
          {advanced && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {kind === "quiz" ? (
                <>
                  <label className="grid gap-1 text-sm font-medium text-fg">{t("hw.timeLimit")}
                    <input type="number" min={1} max={300} inputMode="numeric" className={field} value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} placeholder={t("hw.noLimit")} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-fg">{t("hw.attempts")}
                    <input type="number" min={1} max={10} inputMode="numeric" className={field} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
                  </label>
                </>
              ) : (
                <label className="grid gap-1 text-sm font-medium text-fg">{t("hw.passPercent")}
                  <input type="number" min={0} max={100} inputMode="numeric" className={field} value={minPass} onChange={(e) => setMinPass(e.target.value)} />
                </label>
              )}
            </div>
          )}

          <div className="mt-4 rounded-control border border-dashed border-border-strong p-3" aria-live="polite" data-testid="hw-preview">
            {problem ? <p className="text-sm text-danger">{problem}</p> : !plan ? (
              <p className="text-sm text-fg-muted">{preview.isPending ? t("hw.checking") : t("hw.fillIn")}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-fg-muted">{t("hw.preview.title")}</dt><dd className="font-medium text-fg">{plan.title}</dd>
                <dt className="text-fg-muted">{t("hw.preview.type")}</dt><dd className="font-medium text-fg">{t(`kind.${plan.type}`)}</dd>
                <dt className="text-fg-muted">{t("hw.preview.group")}</dt><dd className="font-medium text-fg">{plan.groupName} · {t("home.students", { n: plan.studentCount })}</dd>
                {plan.questionCount != null && <><dt className="text-fg-muted">{t("hw.preview.size")}</dt><dd className="font-medium text-fg">{plan.type === "vocabulary" ? t("hw.words", { n: plan.questionCount }) : t("hw.questions", { n: plan.questionCount })}</dd></>}
                <dt className="text-fg-muted">{t("hw.deadline")}</dt><dd className="font-medium text-fg">{formatDateTime(plan.deadline)}</dd>
                {plan.type === "quiz" && <><dt className="text-fg-muted">{t("hw.timeLimit")}</dt><dd className="font-medium text-fg">{plan.timeLimitMinutes ? t("hw.minutes", { n: plan.timeLimitMinutes }) : t("hw.noLimit")}</dd></>}
              </dl>
            )}
          </div>
          <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={onAssign} disabled={!plan || assign.isPending} loading={assign.isPending} data-testid="hw-assign">
            <Send />{t("hw.assign")}
          </Button>
          <p className="mt-2 text-xs text-fg-muted">{t("hw.notifyNote")}</p>
        </Step>
      )}
    </>
  );
}
