"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { useAttemptAssessments, useReviewAssessment } from "@/hooks/use-assessment";
import { ApiError } from "@/lib/api-client";
import { assessmentAudioPath, assessmentStatusKey, canAcceptAssessment, criterionKeys, hasActiveAssessments, overrideParts, splitFeedbackLines } from "@/lib/assessment-model";
import type { AssessmentJobView, AssessmentPartFeedback, AssessmentResult, AssessmentReviewAction, AssessmentReviewInput } from "@/lib/assessment-types";

type Translate = ReturnType<typeof useTranslations>;
const TEXT_FEEDBACK = ["taskCoverage", "grammar", "vocabulary", "fluencyCohesion", "ideaDevelopment", "register", "spellingPunctuation", "position", "argumentBalance"] as const;
const LIST_FEEDBACK = ["strengths", "issues", "missedPrompts", "usefulPhrases"] as const;
const ACTIONS: AssessmentReviewAction[] = ["ACCEPT", "OVERRIDE", "EDIT_FEEDBACK", "REGRADE", "NEEDS_REVIEW"];

export function AssessmentPanel({ attemptId, isStaff }: { attemptId: string; isStaff: boolean }) {
  const t = useTranslations("assessment");
  const query = useAttemptAssessments(attemptId);
  return (
    <section id="assessment-feedback" aria-labelledby="assessment-feedback-title" className="mt-6 space-y-4 scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="assessment-feedback-title" className="font-semibold text-fg">{t("title")}</h2>
        <Button variant="outline" size="sm" loading={query.isFetching} onClick={() => query.refresh()}>{t("refresh")}</Button>
      </div>
      {query.isLoading && <p role="status" className="text-sm text-fg-muted">{t("loading")}</p>}
      {query.isError && <Card role="alert" className="p-4 text-sm text-fg-muted">{t("loadError")}</Card>}
      {!query.isLoading && !query.isError && query.data?.assessments.length === 0 && (
        <Card className="p-4 text-sm text-fg-muted">{t("manualFallback")}</Card>
      )}
      {query.pollingStopped && hasActiveAssessments(query.data) && <p role="status" className="text-sm text-fg-muted">{t("pollingPaused")}</p>}
      {query.data?.assessments.map((job) => <AssessmentCard key={`${job.id}:${job.version}`} job={job} attemptId={attemptId} isStaff={isStaff} />)}
    </section>
  );
}

export function AssessmentCard({ job, attemptId, isStaff }: { job: AssessmentJobView; attemptId: string; isStaff: boolean }) {
  const t = useTranslations("assessment");
  const result = job.approvedFeedback ?? job.evaluation?.result;
  const title = job.program === "MULTILEVEL" ? t(`multilevel.${job.skill}`) : t(`ielts.${job.skill}`);
  const reviewed = job.finalScoreSource === "TEACHER";
  const active = ["PENDING", "PROCESSING", "RETRY"].includes(job.status);
  const variant = job.status === "SUCCEEDED" ? "success" : active ? "info" : "warning";
  const pronunciationUnavailable = job.skill === "speaking" && result?.pronunciationEvidence !== "ACOUSTIC";
  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-semibold text-fg">{title}</h3>
          <Badge variant={variant}>{t(`status.${assessmentStatusKey(job)}`)}</Badge>
        </div>
        <p className="text-xs text-fg-subtle">{t("estimated")}</p>
        <dl className="grid gap-2 sm:grid-cols-3">
          {(["aiScore", "teacherScore", "finalScore"] as const).map((key) => <div key={key} className="rounded-[8px] bg-bg-subtle p-3">
            <dt className="text-xs text-fg-muted">{t(key)}</dt>
            <dd className="mt-1 text-lg font-semibold text-fg tabular-nums">{job[key] ?? t("pending")}{job[key] != null && job.program === "MULTILEVEL" ? " /75" : ""}</dd>
          </div>)}
        </dl>
        <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
          <span>{t("source")}: {job.finalScoreSource ? t(`sources.${job.finalScoreSource}`) : t("pending")}</span>
          <span>{t("confidence")}: {job.confidence == null ? t("unavailable") : `${Math.round(job.confidence * 100)}%`}</span>
          <span>{t(`policies.${job.policyMode}`)}</span>
        </div>
        {pronunciationUnavailable && <p className="rounded-[8px] bg-warning-bg p-3 text-sm text-warning">{t("pronunciationUnavailable")}</p>}
        {(job.status === "FAILED" || job.status === "NEEDS_REVIEW") && <p className="text-sm text-fg-muted">{t("reviewFallback")}</p>}
        {job.finalScore == null && <p className="text-sm text-fg-muted">{t("resultPending")}</p>}
        {reviewed && <p className="text-sm text-fg-muted">{t("teacherReviewed")}</p>}
      </div>
      <div className="space-y-5 p-5">
        {job.parts.map((part) => {
          const partResult = result?.parts.find((item) => item.id === part.id);
          const submissions = job.submissions.filter((submission) => submission.partId === part.id);
          return <section key={part.id} className="space-y-3" aria-label={part.task}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-semibold text-fg">{part.task}</h4>
              {job.program === "MULTILEVEL" && partResult && <Badge variant="neutral">{t("aiRawPart")}: {partResult.rawScore ?? t("pending")} /{part.max}</Badge>}
            </div>
            {part.context && <p className="whitespace-pre-wrap text-sm text-fg-muted">{part.context}</p>}
            {job.program === "MULTILEVEL" && job.skill === "speaking" && submissions.length > 1 && <p className="text-xs text-fg-subtle">{t("holisticPart")}</p>}
            {submissions.map((submission) => <div key={submission.questionId} className="space-y-2 rounded-[10px] border border-border p-3">
              <p className="whitespace-pre-wrap text-sm font-medium text-fg">{submission.prompt}</p>
              {submission.context && submission.context !== part.context && <p className="whitespace-pre-wrap text-sm text-fg-muted">{submission.context}</p>}
              <h5 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t("original")}</h5>
              {job.skill === "writing" && <p className="text-xs text-fg-muted">{t("wordCount", { count: submission.wordCount })}</p>}
              {submission.originalResponse && <p className="whitespace-pre-wrap break-words text-sm text-fg">{submission.originalResponse}</p>}
              {submission.audioUrl && <audio controls preload="none" className="w-full max-w-md" aria-label={t("originalAudio")}
                src={assessmentAudioPath(attemptId, submission.questionId)}><track kind="captions" /></audio>}
              {!submission.originalResponse && !submission.audioUrl && <p className="text-sm text-fg-muted">{t("noResponse")}</p>}
              {job.skill === "speaking" && <div className="rounded-[8px] bg-bg-subtle p-3">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t("transcript")}</h5>
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{submission.transcript?.text || t("transcriptPending")}</p>
                {submission.transcript?.confidence != null && <p className="mt-1 text-xs text-fg-subtle">{t("transcriptConfidence")}: {Math.round(submission.transcript.confidence * 100)}%</p>}
                {!!submission.transcript?.segments.length && <details className="mt-2 text-xs text-fg-muted"><summary className="cursor-pointer">{t("segments")}</summary>
                  <ol className="mt-2 space-y-1">{submission.transcript.segments.map((segment, index) => <li key={index}>{segment.start.toFixed(1)}–{segment.end.toFixed(1)}s · {segment.text}</li>)}</ol>
                </details>}
              </div>}
            </div>)}
            {partResult && <div className="space-y-3 rounded-[10px] bg-bg-subtle p-4">
              <h5 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t("feedback")}</h5>
              <p className="text-xs font-medium text-fg-subtle">{t("aiRubric")}</p>
              <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(partResult.criteria).map(([key, score]) => <div key={key} className="text-sm">
                <dt className="text-fg-muted">{t.has(`criteria.${key}`) ? t(`criteria.${key}`) : key}</dt>
                <dd className="font-semibold text-fg tabular-nums">{score ?? t("unavailable")}</dd>
                {partResult.evidence[key] && <p className="mt-1 whitespace-pre-wrap text-xs text-fg-muted">{partResult.evidence[key]}</p>}
              </div>)}</dl>
              <PartFeedbackView feedback={partResult.feedback} t={t} />
            </div>}
            {result?.improvedExamples.filter((example) => example.partId === part.id).map((example, index) => <div key={index} className="rounded-[10px] border border-brand/20 bg-brand-subtle p-4">
              <h5 className="text-xs font-semibold uppercase tracking-wide text-brand-subtle-fg">{t("example")}</h5>
              <p className="mt-1 text-xs text-fg-muted">{t("exampleNotice")}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg">{example.text}</p>
            </div>)}
          </section>;
        })}
        {result && <OverallFeedback result={result} t={t} />}
        {isStaff && job.approvedFeedback && job.evaluation && <details className="rounded-[10px] border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("originalAiFeedback")}</summary>
          <div className="mt-3 space-y-3">{job.evaluation.result.parts.map((part) => <div key={part.id}><h5 className="text-sm font-semibold">{part.id}</h5><PartFeedbackView feedback={part.feedback} t={t} /></div>)}
            <OverallFeedback result={job.evaluation.result} t={t} />
            <FeedbackList title={t("example")} values={job.evaluation.result.improvedExamples.map((example) => `${example.partId}: ${example.text}`)} />
          </div>
        </details>}
        <details className="text-xs text-fg-subtle"><summary className="cursor-pointer">{t("assessmentDetails")}</summary>
          <p className="mt-1 break-words">{job.rubricVersion} · {job.promptVersion}</p>
        </details>
        {isStaff && <AssessmentReviewForm job={job} attemptId={attemptId} />}
      </div>
    </Card>
  );
}

function FeedbackList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return <div><h5 className="text-sm font-semibold text-fg">{title}</h5><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-fg-muted">{values.map((value, index) => <li key={index} className="whitespace-pre-wrap break-words">{value}</li>)}</ul></div>;
}

function PartFeedbackView({ feedback, t }: { feedback: AssessmentPartFeedback; t: Translate }) {
  return <div className="space-y-3">
    {TEXT_FEEDBACK.map((key) => feedback[key] && <div key={key}><h5 className="text-sm font-semibold text-fg">{t(`feedbackFields.${key}`)}</h5><p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{feedback[key]}</p></div>)}
    {LIST_FEEDBACK.map((key) => <FeedbackList key={key} title={t(`feedbackFields.${key}`)} values={feedback[key]} />)}
    {(feedback.forCovered != null || feedback.againstCovered != null) && <div className="flex flex-wrap gap-3 text-sm text-fg-muted">
      <span>{t("forCoverage")}: {feedback.forCovered == null ? t("unavailable") : t(feedback.forCovered ? "covered" : "missed")}</span>
      <span>{t("againstCoverage")}: {feedback.againstCovered == null ? t("unavailable") : t(feedback.againstCovered ? "covered" : "missed")}</span>
    </div>}
  </div>;
}

function OverallFeedback({ result, t }: { result: AssessmentResult; t: Translate }) {
  return <div className="space-y-4 border-t border-border pt-4">
    <FeedbackList title={t("strengths")} values={result.overallStrengths} />
    <FeedbackList title={t("priorities")} values={result.priorityImprovements} />
    {!!result.grammarCorrections.length && <div><h5 className="text-sm font-semibold">{t("corrections")}</h5><ul className="mt-2 space-y-2">{result.grammarCorrections.map((item, index) => <li key={index} className="rounded-[8px] bg-bg-subtle p-3 text-sm">
      <p className="whitespace-pre-wrap text-fg-muted">{t("original")}: {item.original}</p><p className="mt-1 whitespace-pre-wrap text-fg">{t("suggestion")}: {item.corrected}</p><p className="mt-1 text-xs text-fg-muted">{item.explanation}</p>
    </li>)}</ul></div>}
    {!!result.vocabularyUpgrades.length && <div><h5 className="text-sm font-semibold">{t("vocabularyUpgrades")}</h5><ul className="mt-2 space-y-2">{result.vocabularyUpgrades.map((item, index) => <li key={index} className="rounded-[8px] bg-bg-subtle p-3 text-sm">
      <p className="whitespace-pre-wrap text-fg-muted">{item.original} → <span className="font-medium text-fg">{item.alternative}</span></p><p className="mt-1 text-xs text-fg-muted">{item.explanation}</p>
    </li>)}</ul></div>}
    <FeedbackList title={t("practice")} values={result.recommendedPractice} />
  </div>;
}

function initialOverrideValues(job: AssessmentJobView): Record<string, Record<string, string>> {
  return Object.fromEntries(job.parts.map((part) => {
    const result = job.evaluation?.result.parts.find((item) => item.id === part.id);
    return [part.id, job.program === "MULTILEVEL" ? { rawScore: result?.rawScore == null ? "" : String(result.rawScore) }
      : Object.fromEntries(criterionKeys(job).map((key) => [key, result?.criteria[key] == null ? "" : String(result.criteria[key])]))];
  }));
}

export function AssessmentReviewForm({ job, attemptId }: { job: AssessmentJobView; attemptId: string }) {
  const t = useTranslations("assessment");
  const mutation = useReviewAssessment(attemptId, job.id);
  const [action, setAction] = React.useState<AssessmentReviewAction>(canAcceptAssessment(job) ? "ACCEPT" : "OVERRIDE");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [confirmRegrade, setConfirmRegrade] = React.useState(false);
  const [scores, setScores] = React.useState(() => initialOverrideValues(job));
  const [feedback, setFeedback] = React.useState<AssessmentResult | null>(() => {
    const value = job.approvedFeedback ?? job.evaluation?.result;
    return value ? structuredClone(value) : null;
  });
  const busy = ["PENDING", "PROCESSING", "RETRY"].includes(job.status);

  function updatePartFeedback<K extends keyof AssessmentPartFeedback>(partId: string, key: K, value: AssessmentPartFeedback[K]) {
    setFeedback((current) => current ? { ...current, parts: current.parts.map((part) => part.id === partId ? { ...part, feedback: { ...part.feedback, [key]: value } } : part) } : current);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (reason.trim().length < 3) { setError(t("reasonRequired")); return; }
    if (action === "ACCEPT" && !canAcceptAssessment(job)) { setError(t("acceptUnavailable")); return; }
    if (action === "REGRADE" && !confirmRegrade) { setError(t("regradeConfirm")); return; }
    const input: AssessmentReviewInput = { action, expectedVersion: job.version, reason: reason.trim() };
    if (action === "OVERRIDE") {
      try { input.parts = overrideParts(job, scores); } catch { setError(t("invalidScore")); return; }
    }
    if (action === "EDIT_FEEDBACK") {
      if (!feedback) { setError(t("feedbackUnavailable")); return; }
      input.feedback = feedback;
    }
    mutation.mutate(input, {
      onSuccess: () => toast.success(t("reviewSaved")),
      onError: (failure) => setError(failure instanceof ApiError && /CONFLICT|STALE/.test(failure.code) ? t("staleReview") : t("reviewError")),
    });
  }

  return <form onSubmit={submit} className="space-y-3 rounded-[10px] border border-border bg-bg-subtle p-4" aria-label={t("teacherReview")}>
    <h4 className="font-semibold">{t("teacherReview")}</h4>
    <p className="text-xs text-fg-muted">{t("auditNotice")}</p>
    <label className="block space-y-1 text-sm"><span>{t("action")}</span>
      <select value={action} onChange={(event) => { setAction(event.target.value as AssessmentReviewAction); setError(null); }} className="w-full rounded-[8px] border border-border bg-surface p-2 text-fg">
        {ACTIONS.map((value) => <option value={value} key={value}>{t(`actions.${value}`)}</option>)}
      </select>
    </label>
    {action === "ACCEPT" && !canAcceptAssessment(job) && <p className="text-sm text-fg-muted">{t("acceptUnavailable")}</p>}
    {action === "OVERRIDE" && <div className="space-y-3">
      {job.skill === "speaking" && job.program !== "MULTILEVEL" && <p className="text-sm text-warning">{t("teacherPronunciation")}</p>}
      {job.parts.map((part) => <fieldset key={part.id} className="space-y-2 rounded-[8px] border border-border p-3"><legend className="px-1 text-sm font-semibold">{part.task}</legend>
        {(job.program === "MULTILEVEL" ? ["rawScore"] : criterionKeys(job)).map((key) => <label key={key} className="flex items-center justify-between gap-3 text-sm">
          <span>{key === "rawScore" ? t("rawPart") : t(`criteria.${key}`)} (0–{job.program === "MULTILEVEL" ? part.max : 9})</span>
          <Input type="number" min={0} max={job.program === "MULTILEVEL" ? part.max : 9} step={0.5} required value={scores[part.id]?.[key] ?? ""} className="w-24"
            onChange={(event) => setScores((current) => ({ ...current, [part.id]: { ...current[part.id], [key]: event.target.value } }))} />
        </label>)}
      </fieldset>)}
    </div>}
    {action === "EDIT_FEEDBACK" && (feedback ? <div className="space-y-3">
      {(["overallStrengths", "priorityImprovements", "recommendedPractice"] as const).map((key) => <label className="block space-y-1 text-sm" key={key}><span>{t(key === "overallStrengths" ? "strengths" : key === "priorityImprovements" ? "priorities" : "practice")}</span>
        <Textarea value={feedback[key].join("\n")} maxLength={12000} onChange={(event) => setFeedback({ ...feedback, [key]: splitFeedbackLines(event.target.value) })} />
      </label>)}
      {feedback.parts.map((part) => <details key={part.id} className="rounded-[8px] border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">{job.parts.find((item) => item.id === part.id)?.task ?? part.id}</summary>
        <div className="mt-3 space-y-3">{TEXT_FEEDBACK.map((key) => <label key={key} className="block space-y-1 text-sm"><span>{t(`feedbackFields.${key}`)}</span>
          <Textarea value={part.feedback[key]} maxLength={12000} onChange={(event) => updatePartFeedback(part.id, key, event.target.value)} />
        </label>)}{LIST_FEEDBACK.map((key) => <label key={key} className="block space-y-1 text-sm"><span>{t(`feedbackFields.${key}`)}</span>
          <Textarea value={part.feedback[key].join("\n")} maxLength={12000} onChange={(event) => updatePartFeedback(part.id, key, splitFeedbackLines(event.target.value))} />
        </label>)}</div>
      </details>)}
      {feedback.improvedExamples.map((example, index) => <label key={`${example.partId}:${index}`} className="block space-y-1 text-sm"><span>{t("example")} · {job.parts.find((part) => part.id === example.partId)?.task ?? example.partId}</span>
        <Textarea value={example.text} maxLength={20000} onChange={(event) => setFeedback({ ...feedback, improvedExamples: feedback.improvedExamples.map((item, position) => position === index ? { ...item, text: event.target.value } : item) })} />
      </label>)}
    </div> : <p className="text-sm text-fg-muted">{t("feedbackUnavailable")}</p>)}
    {action === "REGRADE" && <label className="flex items-start gap-2 text-sm text-fg-muted"><input type="checkbox" checked={confirmRegrade} onChange={(event) => setConfirmRegrade(event.target.checked)} className="mt-1" />{t("regradeConfirm")}</label>}
    <label className="block space-y-1 text-sm"><span>{t("reason")}</span><Textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={2000} required /></label>
    {busy && <p role="status" className="text-sm text-fg-muted">{t("waitForWorker")}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Button type="submit" size="sm" loading={mutation.isPending} disabled={busy || (action === "ACCEPT" && !canAcceptAssessment(job)) || (action === "EDIT_FEEDBACK" && !feedback)}>{t("saveReview")}</Button>
  </form>;
}
