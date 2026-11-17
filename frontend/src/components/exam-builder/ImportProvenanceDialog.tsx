"use client";

import * as React from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MockExamDetail, MockExamImportProvenance } from "@/lib/types";
import { tx, type Selection } from "./types";

/** Resolve an issue's source to an editor selection via the import source map. */
export function issueSelection(
  detail: MockExamDetail,
  provenance: MockExamImportProvenance,
  issue: { sourceKey: string | null; entityKind: string | null },
): Selection | null {
  if (!issue.sourceKey || !issue.entityKind) return null;
  const map = provenance.sourceMaps.find(
    (m) => m.kind === issue.entityKind && m.sourceKey === issue.sourceKey,
  );
  if (!map) return null;
  if (map.kind === "section") {
    if (!detail.sections.some((s) => s.id === map.entityId)) return null;
    return { kind: "section", sectionId: map.entityId };
  }
  for (const s of detail.sections) {
    if (map.kind === "group" && s.groups.some((g) => g.id === map.entityId)) {
      return { kind: "group", groupId: map.entityId };
    }
    if (map.kind === "question") {
      const g = s.groups.find((gr) => gr.questions.some((q) => q.id === map.entityId));
      if (g) return { kind: "group", groupId: g.id };
    }
  }
  return null;
}

/**
 * AI import provenance for the open draft: package identity, import time and
 * open review issues with one-click navigation. Never shows credentials,
 * answer keys or raw import payloads.
 */
export function ImportProvenanceDialog({
  open,
  onClose,
  detail,
  provenance,
  loading,
  onSelect,
  onResolve,
  resolvingId,
}: {
  open: boolean;
  onClose: () => void;
  detail: MockExamDetail;
  provenance: MockExamImportProvenance | null | undefined;
  loading: boolean;
  onSelect: (s: Selection) => void;
  onResolve: (issueId: string) => void;
  resolvingId: string | null;
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tx(t, "provenanceTitle", "AI import details")}</DialogTitle>
          <DialogDescription>
            {tx(t, "provenanceHint", "Where this draft came from and what still needs review.")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loading || !provenance ? (
            <p className="inline-flex items-center gap-2 text-sm text-fg-muted" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {tc("loading")}
            </p>
          ) : (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-fg-muted">{tx(t, "provenancePackage", "Package")}</dt>
                  <dd className="break-all font-mono text-xs">{provenance.packageId}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">{tx(t, "provenanceRevision", "Revision")}</dt>
                  <dd className="tabular-nums">{provenance.revision}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">{tx(t, "provenanceImportedAt", "Imported")}</dt>
                  <dd className="text-xs">
                    {new Date(provenance.importedAt).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">{tx(t, "provenanceOpenIssues", "Open issues")}</dt>
                  <dd>
                    <Badge variant={provenance.openIssues > 0 ? "warning" : "success"}>
                      {provenance.openIssues}
                    </Badge>
                  </dd>
                </div>
              </dl>
              {provenance.issues.length === 0 ? (
                <p className="inline-flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="size-4" aria-hidden />
                  {tx(t, "provenanceNoIssues", "No review issues — the package was clean.")}
                </p>
              ) : (
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {provenance.issues.map((issue) => {
                    const sel = issueSelection(detail, provenance, issue);
                    const resolved = issue.status === "resolved";
                    return (
                      <li
                        key={issue.id}
                        className="rounded-field border border-border p-2.5 text-sm"
                      >
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold">{issue.code}</span>
                          <Badge variant={resolved ? "success" : "warning"}>
                            {resolved ? tx(t, "resolved", "Resolved") : tx(t, "open", "Open")}
                          </Badge>
                        </p>
                        <p className="mt-1 break-words text-fg-muted">{issue.message}</p>
                        <p className="mt-0.5 break-all font-mono text-[11px] text-fg-subtle">
                          {issue.path}
                        </p>
                        {!resolved && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {sel && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  onSelect(sel);
                                  onClose();
                                }}
                              >
                                {tx(t, "openLocation", "Open location")}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={resolvingId === issue.id}
                              onClick={() => onResolve(issue.id)}
                            >
                              {tx(t, "markResolved", "Mark resolved")}
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="min-h-10 justify-center">
            {tc("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


