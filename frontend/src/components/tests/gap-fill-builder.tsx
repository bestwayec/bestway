"use client";

import * as React from "react";
import { Layers, TriangleAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Textarea, Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api-client";
import {
  buildGapQuestions,
  parseGapText,
  toQuestionPayload,
  violatesWordLimit,
} from "@/lib/gap-fill";

const EXAMPLE = `Transport survey
Name: Sadie Jones
Year of birth: 1991

Travelling by bus
Date of bus journey: __________
Reason for trip: shopping and visit to the __________
Travelled by bus because cost of __________ too high
Got on bus at __________ Street

Complaints about bus service:
bus today was __________
frequency of buses in the __________`;

export function GapFillBuilder({
  open,
  onClose,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  testId: string;
}) {
  const qc = useQueryClient();
  const [raw, setRaw] = React.useState("");
  const [section, setSection] = React.useState<"listening" | "reading">("listening");
  const [answers, setAnswers] = React.useState<Record<number, string>>({});
  const [busy, setBusy] = React.useState(false);

  const parsed = React.useMemo(() => parseGapText(raw), [raw]);
  const drafts = React.useMemo(() => buildGapQuestions(raw, answers), [raw, answers]);
  const missing = drafts.filter((d) => !d.correctAnswer);
  const canCreate = parsed.gapCount > 0 && missing.length === 0 && !busy;

  function reset() {
    setRaw("");
    setAnswers({});
    setSection("listening");
    setBusy(false);
  }

  async function handleCreate() {
    if (!canCreate) return;
    setBusy(true);
    try {
      let ok = 0;
      for (const d of drafts) {
        await api.post(`/tests/${testId}/questions`, toQuestionPayload(d, section));
        ok += 1;
      }
      await qc.invalidateQueries({ queryKey: ["test"] });
      await qc.invalidateQueries({ queryKey: ["tests"] });
      toast.success(`${ok} gap-fill questions created (${section})`);
      reset();
      onClose();
    } catch (e) {
      const msg =
        e instanceof ApiError ? `${e.message} (${e.code})` : "Failed to create questions";
      toast.error(msg);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4 text-brand" />
            Gap-fill builder
            {parsed.gapCount > 0 && (
              <Badge variant="info">
                {parsed.gapCount} gap{parsed.gapCount === 1 ? "" : "s"} found
              </Badge>
            )}
          </DialogTitle>
          <p className="text-xs text-fg-muted">
            Paste text with blanks as __________ — each blank becomes one auto-graded{" "}
            <span className="font-medium">short answer</span> question. Write ONE WORD AND/OR A
            NUMBER per answer; use <span className="font-mono">|</span> for alternatives
            (e.g. <span className="font-mono">High|High Street</span>).
          </p>
        </DialogHeader>

        <DialogBody className="px-5 pb-3 overflow-y-auto space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Section" className="w-44">
              <Select value={section} onValueChange={(v) => setSection(v as typeof section)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="listening">listening</SelectItem>
                  <SelectItem value="reading">reading</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRaw(EXAMPLE)}
              disabled={busy}
              className="ml-auto"
            >
              Load Sadie Jones example
            </Button>
          </div>

          <Field label="Pasted text (blanks = __________)">
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={10}
              disabled={busy}
              placeholder="Reason for trip: shopping and visit to the __________"
              className="font-mono text-[13px]"
            />
          </Field>

          {parsed.gapCount > 0 && (
            <>
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">Preview (student sees inputs on blanks)</p>
                <div className="rounded-[10px] border border-border bg-surface px-3 py-2 text-sm leading-7 whitespace-pre-wrap">
                  {parsed.segments.map((s, i) =>
                    s.kind === "text" ? (
                      <span key={i}>{s.value}</span>
                    ) : (
                      <span
                        key={i}
                        className="mx-0.5 inline-flex min-w-16 items-center justify-center rounded-md border border-dashed border-brand/50 bg-brand-subtle px-2 py-0.5 align-middle font-mono text-xs text-brand-subtle-fg"
                      >
                        {s.gapIndex}
                      </span>
                    ),
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-fg-muted">
                  Answers ({drafts.length - missing.length}/{drafts.length} filled)
                </p>
                {drafts.map((d) => (
                  <div key={d.gapNumber} className="flex flex-col gap-1 rounded-[10px] border border-border p-2.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="info">[{d.gapNumber}]</Badge>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-muted">
                        {d.prompt}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={answers[d.gapNumber] ?? ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({ ...prev, [d.gapNumber]: e.target.value }))
                        }
                        disabled={busy}
                        placeholder="correct answer (| for alternatives)"
                        className="font-mono text-[13px]"
                      />
                    </div>
                    {violatesWordLimit(answers[d.gapNumber] ?? "") && (
                      <p className="flex items-center gap-1 text-[11px] text-amber-600">
                        <TriangleAlert className="size-3" />
                        More than one word — IELTS limit is ONE WORD AND/OR A NUMBER.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {raw.trim() && parsed.gapCount === 0 && (
            <p className="text-xs text-amber-600">
              No blanks found — mark each blank with 2+ underscores (__________).
            </p>
          )}
        </DialogBody>

        <DialogFooter className="px-5 pb-5 shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canCreate} loading={busy}>
            Create {parsed.gapCount > 0 ? `${parsed.gapCount} ` : ""}questions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
