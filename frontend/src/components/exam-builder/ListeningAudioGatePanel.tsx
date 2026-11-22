"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Music, ShieldAlert, TriangleAlert, Upload, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { useExamGate, useSetContentRights, useUploadListeningAudio, useVerifyListeningAudio } from "@/hooks/use-mock";
import { useMe } from "@/hooks/use-me";
import { ApiError } from "@/lib/api-client";
import {
  AUDIO_ACCEPT,
  canSubmitVerification,
  draftNotice,
  fmtDuration,
  fmtSize,
  precheckAudioFile,
  rangeLabel,
  statusVariant,
  summarize,
  verifiable,
  type ListeningPartAudio,
} from "@/lib/listening-audio";
import { tx } from "./types";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * Audio status and verification for a gated (supplied-material) mock.
 * Renders nothing for ordinary exams. Status is whatever the server derives:
 * MISSING / UPLOADED / VERIFIED. The student exam never sees any of this.
 */
export function ListeningAudioGatePanel({ examId }: { examId: string }) {
  const t = useTranslations("examBuilder");
  const gate = useExamGate(examId);
  const me = useMe();
  const role = me.data?.user.role;
  const upload = useUploadListeningAudio(examId);
  const [verifying, setVerifying] = React.useState<ListeningPartAudio | null>(null);
  const [rightsOpen, setRightsOpen] = React.useState(false);

  if (!gate.data?.gated) return null;
  const data = gate.data;
  const parts = data.audio.parts;
  const counts = summarize(parts);
  const isAdmin = role === "admin" || role === "super_admin";
  const notice = draftNotice(data);

  function onFile(part: ListeningPartAudio, file: File | undefined) {
    if (!file) return;
    const problem = precheckAudioFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    upload.mutate(
      { groupId: part.groupId, file },
      {
        onSuccess: (r) => {
          toast.success(r.replaced ? tx(t, "audioReplaced", "Recording replaced — verify it again.") : tx(t, "audioUploaded", "Recording uploaded — waiting for verification."));
          r.warnings?.forEach((w) => toast.warning(w));
        },
        onError: (e) => toast.error(errorText(e, tx(t, "audioUploadFailed", "Upload failed."))),
      },
    );
  }

  return (
    <Card aria-label={tx(t, "audioGate", "Listening audio status")}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <Music className="size-4" aria-hidden />
            {tx(t, "audioGate", "Listening audio status")}
          </h3>
          <Badge variant={counts.verified === counts.total && counts.total > 0 ? "success" : "warning"}>
            {counts.verified}/{counts.total || 4} {tx(t, "verifiedLower", "verified")}
          </Badge>
          {!data.published && <Badge variant="neutral">DRAFT</Badge>}
        </div>

        {notice && (
          <p className="flex items-start gap-2 rounded-field border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning" role="status">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{tx(t, "draftNotice", notice)}</span>
          </p>
        )}

        <ul className="divide-y divide-border rounded-field border border-border" aria-label={tx(t, "audioParts", "Listening parts")}>
          {parts.map((part) => (
            <PartRow
              key={part.groupId}
              part={part}
              uploading={upload.isPending && upload.variables?.groupId === part.groupId}
              canVerify={verifiable(part, role)}
              onFile={(f) => onFile(part, f)}
              onVerify={() => setVerifying(part)}
            />
          ))}
          {parts.length === 0 && <li className="p-3 text-sm text-fg-muted">{tx(t, "noParts", "No Listening parts yet.")}</li>}
        </ul>

        <section aria-label={tx(t, "contentRights", "Content rights")} className="rounded-field border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-fg">{tx(t, "contentRights", "Content rights")}</p>
            <Badge variant={data.rights?.status === "unverified" ? "danger" : "success"}>
              {data.rights?.status ?? "unverified"}
            </Badge>
            {isAdmin && (
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => setRightsOpen(true)}>
                {data.rights?.status === "verified" ? tx(t, "withdrawRights", "Withdraw / update") : tx(t, "recordRights", "Record verified rights")}
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {data.rights?.status === "unverified"
              ? tx(t, "rightsUnverifiedHint", "The supplied Listening and Reading material has no verified redistribution permission. An administrator must record written permission before this exam can be published.")
              : data.rights?.note ?? tx(t, "rightsOk", "Redistribution rights are recorded.")}
          </p>
        </section>

        {data.blockers.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{tx(t, "publishBlockers", "Blocking publication")}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg">
              {data.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      {verifying && <VerifyDialog examId={examId} part={verifying} onClose={() => setVerifying(null)} />}
      {rightsOpen && <RightsDialog examId={examId} current={data.rights?.status} onClose={() => setRightsOpen(false)} />}
    </Card>
  );
}

function PartRow({
  part,
  uploading,
  canVerify,
  onFile,
  onVerify,
}: {
  part: ListeningPartAudio;
  uploading: boolean;
  canVerify: boolean;
  onFile: (f: File | undefined) => void;
  onVerify: () => void;
}) {
  const t = useTranslations("examBuilder");
  const input = React.useRef<HTMLInputElement | null>(null);
  const range = rangeLabel(part);
  const Icon = part.status === "VERIFIED" ? CheckCircle2 : part.status === "UPLOADED" ? TriangleAlert : XCircle;
  return (
    <li className="space-y-2 p-3" data-testid={`audio-part-${part.partNumber}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-fg">
          {tx(t, "part", "Part")} {part.partNumber ?? "?"}
          {range && <span className="ml-1.5 font-normal text-fg-muted">Q{range}</span>}
        </p>
        <Badge variant={statusVariant(part.status)} data-testid="audio-status">
          <Icon className="size-3" aria-hidden />
          {part.status}
        </Badge>
        {part.audio && (
          <span className="text-xs text-fg-muted">
            {part.audio.container.toUpperCase()} · {fmtDuration(part.durationSec)} · {fmtSize(part.audio.sizeBytes)} · r{part.audio.revision}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <input
            ref={input}
            type="file"
            accept={AUDIO_ACCEPT}
            className="hidden"
            aria-label={`${tx(t, "uploadAudio", "Upload audio")} ${part.partNumber ?? ""}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              onFile(f);
            }}
          />
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {part.hasAudio ? tx(t, "replaceAudio", "Replace audio") : tx(t, "uploadAudio", "Upload audio")}
          </Button>
          {canVerify && (
            <Button size="sm" onClick={onVerify}>
              {tx(t, "verify", "Verify")}
            </Button>
          )}
        </span>
      </div>
      {part.hasAudio && (
        <audio controls preload="none" className="h-9 w-full" src={`/api/backend/mock/groups/${part.groupId}/audio`} aria-label={`Part ${part.partNumber} recording`} />
      )}
      {part.status !== "VERIFIED" && part.problems.length > 0 && (
        <ul className="text-xs text-fg-muted">
          {part.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function VerifyDialog({ examId, part, onClose }: { examId: string; part: ListeningPartAudio; onClose: () => void }) {
  const t = useTranslations("examBuilder");
  const verify = useVerifyListeningAudio(examId);
  const [ticked, setTicked] = React.useState<number[]>([]);
  const [listened, setListened] = React.useState(false);
  const [note, setNote] = React.useState("");
  const ok = canSubmitVerification(part, ticked, listened);
  const toggle = (n: number) => setTicked((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {tx(t, "verifyPart", "Verify Part")} {part.partNumber}
          </DialogTitle>
          <DialogDescription>
            {tx(t, "verifyHint", "Play the whole recording and confirm that the correct answer to every question can be heard. Editing an answer key or replacing the file later will require verification again.")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <audio
            controls
            preload="metadata"
            className="h-9 w-full"
            src={`/api/backend/mock/groups/${part.groupId}/audio`}
            aria-label={`Part ${part.partNumber} recording`}
            onEnded={() => setListened(true)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={listened} onChange={(e) => setListened(e.target.checked)} />
            {tx(t, "listenedFully", "I listened to the whole recording")}
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-fg">{tx(t, "answersHeard", "The answer is heard in the recording for:")}</legend>
            <div className="mt-1 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
              {part.questionNumbers.map((n) => (
                <label key={n} className="flex items-center justify-center gap-1 rounded-field border border-border px-1.5 py-1 text-sm tabular-nums">
                  <input type="checkbox" checked={ticked.includes(n)} onChange={() => toggle(n)} aria-label={`Question ${n}`} />
                  {n}
                </label>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setTicked(part.questionNumbers)}>
              {tx(t, "tickAll", "Tick all after checking")}
            </Button>
          </fieldset>
          <Textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={tx(t, "noteOptional", "Note (optional)")} rows={2} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tx(t, "cancel", "Cancel")}
          </Button>
          <Button
            disabled={!ok}
            loading={verify.isPending}
            onClick={() =>
              verify.mutate(
                { groupId: part.groupId, heardQuestions: ticked, note },
                {
                  onSuccess: () => {
                    toast.success(tx(t, "partVerified", "Part verified."));
                    onClose();
                  },
                  onError: (e) => toast.error(errorText(e, tx(t, "verifyFailed", "Verification failed."))),
                },
              )
            }
          >
            {tx(t, "confirmVerify", "Confirm verification")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RightsDialog({ examId, current, onClose }: { examId: string; current?: string; onClose: () => void }) {
  const t = useTranslations("examBuilder");
  const setRights = useSetContentRights(examId);
  const [evidence, setEvidence] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  const valid = confirm && evidence.trim().length >= 20;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tx(t, "contentRights", "Content rights")}</DialogTitle>
          <DialogDescription>
            {tx(t, "rightsHint", "Record where the written permission to publish this material to students comes from (licence, contract, email reference). This is stored with your name and date.")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={3} placeholder={tx(t, "rightsEvidence", "Permission reference (at least 20 characters)")} aria-label="Permission reference" />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            {tx(t, "rightsConfirm", "I confirm BESTWAY has the right to publish this material to students.")}
          </label>
        </DialogBody>
        <DialogFooter>
          {current === "verified" && (
            <Button
              variant="danger"
              loading={setRights.isPending}
              onClick={() => setRights.mutate({ status: "unverified", evidence: "" }, { onSuccess: onClose, onError: (e) => toast.error(errorText(e, "Failed")) })}
            >
              {tx(t, "withdrawRightsConfirm", "Withdraw rights and unpublish")}
            </Button>
          )}
          <Button
            disabled={!valid}
            loading={setRights.isPending}
            onClick={() =>
              setRights.mutate(
                { status: "verified", evidence },
                { onSuccess: onClose, onError: (e) => toast.error(errorText(e, tx(t, "rightsFailed", "Could not record rights."))) },
              )
            }
          >
            {tx(t, "saveRights", "Record verified rights")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
