"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportExamTemplate, useExportExam, type ExportSkill } from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import { downloadJsonText, exportFileName } from "./import-json";
import { tx } from "./types";

/**
 * Export the exam (or one skill) as a schema-1.0 package that the Import JSON
 * dialog accepts unchanged. Contains answer keys — the server allows only the
 * owner teacher or an admin. Audio/image files are listed, not embedded.
 */
export function ExportExamDialog({
  open,
  onClose,
  examId,
  title,
  skills,
}: {
  open: boolean;
  onClose: () => void;
  examId: string;
  title: string;
  skills: ExportSkill[];
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const exportExam = useExportExam();
  const [mode, setMode] = React.useState<"full" | "template">("full");
  const [templateBusy, setTemplateBusy] = React.useState<ExportSkill | "all" | null>(null);
  const busy = exportExam.isPending || templateBusy !== null;

  async function run(skill?: ExportSkill) {
    if (mode === "template") {
      setTemplateBusy(skill ?? "all");
      try {
        const pkg = await exportExamTemplate(examId, { skill });
        downloadJsonText(exportFileName(`${title}-template`, skill), `${JSON.stringify(pkg, null, 2)}\n`);
        toast.success(tx(t, "templateExportDone", "Template exported — no answer keys are included."));
        onClose();
      } catch (e) {
        toast.error(e instanceof ApiError ? `${e.message} (${e.code})` : tc("unknownError"));
      } finally {
        setTemplateBusy(null);
      }
      return;
    }
    exportExam.mutate(
      { examId, skill },
      {
        onSuccess: (pkg) => {
          downloadJsonText(exportFileName(title, skill), `${JSON.stringify(pkg, null, 2)}\n`);
          toast.success(tx(t, "exportDone", "Exported as JSON — media files are listed in the package but not embedded."));
          onClose();
        },
        onError: (e) => toast.error(e instanceof ApiError ? `${e.message} (${e.code})` : tc("unknownError")),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tx(t, "exportJson", "Export JSON")}</DialogTitle>
          <DialogDescription>
            {tx(
              t,
              "exportHint",
              "Download a schema 1.0 package you can re-import as a new exam or into another draft. It includes answer keys — share it only with staff. Audio and images must be attached again after re-import.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <div className="grid grid-cols-2 gap-1 rounded-control border border-border p-1" role="radiogroup" aria-label={tx(t, "exportMode", "What to export")}>
            {(["full", "template"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={`min-h-9 rounded-[calc(var(--radius-control)-2px)] px-2 text-xs font-medium transition-colors ${mode === value ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-hover"}`}
              >
                {value === "full" ? tx(t, "exportModeFull", "With answer keys") : tx(t, "exportModeTemplate", "Template (no keys)")}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-muted">
            {mode === "full"
              ? tx(t, "exportModeFullHint", "Complete copy for backup or moving to another draft. Contains answer keys — staff only.")
              : tx(t, "exportModeTemplateHint", "Questions, passages and options without answer keys or answer evidence. A draft made from it cannot be published until keys are added.")}
          </p>
          <Button
            className="min-h-10 w-full justify-center"
            onClick={() => void run()}
            loading={(exportExam.isPending && !exportExam.variables?.skill) || templateBusy === "all"}
            disabled={busy || skills.length === 0}
          >
            <Download className="size-4" aria-hidden />
            {tx(t, "exportWholeExam", "Whole exam")}
          </Button>
          {skills.length > 1 && (
            <div className="grid grid-cols-2 gap-2">
              {skills.map((skill) => (
                <Button
                  key={skill}
                  variant="outline"
                  className="min-h-10 justify-center capitalize"
                  onClick={() => void run(skill)}
                  loading={(exportExam.isPending && exportExam.variables?.skill === skill) || templateBusy === skill}
                  disabled={busy}
                >
                  {skill}
                </Button>
              ))}
            </div>
          )}
          {skills.length === 0 && (
            <p className="text-sm text-fg-muted">{tx(t, "exportEmpty", "This exam has no sections to export yet.")}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy} className="min-h-10 justify-center">
            {tc("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
