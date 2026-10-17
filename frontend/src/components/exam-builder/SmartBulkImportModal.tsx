"use client";

import * as React from "react";
import {
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Headphones,
  Loader2,
  Music,
  Play,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  useAudioTimestamps,
  useExamBulkImport,
  useGroupBulkImport,
  useImportExamExcel,
  useSaveAudioTimestamps,
  useSmartParseQuestions,
} from "@/hooks/use-mock";
import { api, ApiError } from "@/lib/api-client";
import type {
  AudioTimestampItem,
  MockExamType,
  MockGroup,
  MockQuestionType,
  MockSkill,
  SmartParseQuestion,
  SmartParseResult,
} from "@/lib/types";
import type { ImportedServerQuestion } from "./ImportPanel";

export type SmartImportTab = "smart-text" | "excel" | "audio-timestamps";

interface SmartBulkImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  examType?: MockExamType;
  groupId?: string;
  groupLabel?: string;
  defaultSkill?: MockSkill;
  defaultTab?: SmartImportTab;
  listeningGroups?: MockGroup[];
  onImported?: (questions?: ImportedServerQuestion[]) => void;
}

const QUESTION_TYPE_BADGE: Record<
  string,
  { label: string; variant: "info" | "success" | "warning" | "neutral" | "brand" }
> = {
  multiple_choice: { label: "Multiple Choice", variant: "info" },
  multi_select: { label: "Multi-Select", variant: "info" },
  true_false_notgiven: { label: "TFNG", variant: "warning" },
  yes_no_notgiven: { label: "YNNG", variant: "warning" },
  matching: { label: "Matching", variant: "brand" },
  matching_headings: { label: "Matching Headings", variant: "brand" },
  sentence_completion: { label: "Fill in the blank", variant: "success" },
  note_completion: { label: "Note Completion", variant: "success" },
  summary_completion: { label: "Summary Completion", variant: "success" },
  table_completion: { label: "Table Completion", variant: "success" },
  short_answer: { label: "Short Answer", variant: "neutral" },
  map_labelling: { label: "Map Labelling", variant: "brand" },
};

const SAMPLE_SMART_TEXT = `PASSAGE 1
The Rise of Urban Vertical Farming
In recent decades, vertical farming has emerged as a promising solution to urban food security. By cultivating crops in vertically stacked layers indoors, growers can control light, humidity, and nutrients year-round.

1. What is the main advantage of vertical farming mentioned in the text?
A) Lower electricity consumption
B) Year-round climate control indoors
C) Reduced need for trained staff
D) Free municipal water supply

2. Vertical farms require more land than traditional farms.
TRUE / FALSE / NOT GIVEN

3. Crops are grown in ___ stacked layers indoors.

4. Match the feature with the correct category:
A) LED Lighting
B) Hydroponic roots
C) Urban distribution

Answers:
1: B
2: FALSE
3: vertically
4: A`;

function formatSecondsToMmSs(sec: number): string {
  const safe = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseMmSsToSeconds(raw: string): number {
  const clean = raw.trim();
  if (!clean) return 0;
  if (/^\d+(\.\d+)?$/.test(clean)) {
    return Math.max(0, Math.round(Number(clean)));
  }
  const parts = clean.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

export function SmartBulkImportModal({
  open,
  onOpenChange,
  examId,
  examType = "ielts_academic",
  groupId,
  groupLabel,
  defaultSkill = "reading",
  defaultTab = "smart-text",
  listeningGroups = [],
  onImported,
}: SmartBulkImportModalProps) {
  const normalizedSkill: "reading" | "listening" =
    defaultSkill === "listening" ? "listening" : "reading";

  const [activeTab, setActiveTab] = React.useState<SmartImportTab>(defaultTab);
  const [skill, setSkill] = React.useState<"reading" | "listening">(normalizedSkill);
  const [targetScope, setTargetScope] = React.useState<"exam" | "group">(
    groupId ? "group" : "exam",
  );
  const [replaceExisting, setReplaceExisting] = React.useState(false);

  // Tab 1: Smart Text Parser state
  const [rawText, setRawText] = React.useState("");
  const [parseResult, setParseResult] = React.useState<SmartParseResult | null>(null);
  const [editableQuestions, setEditableQuestions] = React.useState<SmartParseQuestion[]>([]);
  const [editableAnswers, setEditableAnswers] = React.useState<Record<string, string>>({});
  const [editablePassage, setEditablePassage] = React.useState("");
  const [editableInstructions, setEditableInstructions] = React.useState("");

  // Tab 2: Excel / CSV state
  const [excelFile, setExcelFile] = React.useState<File | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = React.useState(false);
  const excelInputRef = React.useRef<HTMLInputElement | null>(null);

  // Tab 3: Single Audio & Timestamps state
  const [audioFile, setAudioFile] = React.useState<File | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = React.useState<string | null>(null);
  const [audioDurationSec, setAudioDurationSec] = React.useState<number | undefined>(undefined);
  const audioPlayerRef = React.useRef<HTMLAudioElement | null>(null);
  const audioInputRef = React.useRef<HTMLInputElement | null>(null);

  const partCount = examType === "multilevel" ? 6 : 4;
  const [timestampRows, setTimestampRows] = React.useState<
    Array<{
      partNumber: number;
      groupId?: string;
      label: string;
      startMmSs: string;
      endMmSs: string;
    }>
  >(() =>
    Array.from({ length: partCount }, (_, idx) => ({
      partNumber: idx + 1,
      groupId: listeningGroups[idx]?.id,
      label: listeningGroups[idx]?.title || `Part ${idx + 1}`,
      startMmSs: formatSecondsToMmSs(idx * 420),
      endMmSs: formatSecondsToMmSs((idx + 1) * 420),
    })),
  );

  const smartParseMut = useSmartParseQuestions();
  const examBulkMut = useExamBulkImport(examId);
  const groupBulkMut = useGroupBulkImport(examId);
  const excelImportMut = useImportExamExcel(examId);
  const timestampsQ = useAudioTimestamps(examId, open && activeTab === "audio-timestamps");
  const saveTimestampsMut = useSaveAudioTimestamps(examId);

  React.useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
      setSkill(defaultSkill === "listening" ? "listening" : "reading");
      setTargetScope(groupId ? "group" : "exam");
    }
  }, [open, defaultTab, defaultSkill, groupId]);

  React.useEffect(() => {
    if (!timestampsQ.data?.timestamps?.length) return;
    const serverRows = timestampsQ.data.timestamps;
    setTimestampRows(
      Array.from({ length: partCount }, (_, idx) => {
        const partNo = idx + 1;
        const found = serverRows.find((r) => r.partNumber === partNo);
        return {
          partNumber: partNo,
          groupId: found?.groupId ?? listeningGroups[idx]?.id,
          label: found?.label || listeningGroups[idx]?.title || `Part ${partNo}`,
          startMmSs: formatSecondsToMmSs(found?.startSec ?? idx * 420),
          endMmSs:
            found?.endSec != null
              ? formatSecondsToMmSs(found.endSec)
              : formatSecondsToMmSs((idx + 1) * 420),
        };
      }),
    );
    if (timestampsQ.data.durationSec) {
      setAudioDurationSec(timestampsQ.data.durationSec);
    }
  }, [timestampsQ.data, partCount, listeningGroups]);

  React.useEffect(
    () => () => {
      if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
    },
    [localAudioUrl],
  );

  async function handleSmartParse() {
    if (!rawText.trim()) {
      toast.error("Avval savollar matnini kiriting");
      return;
    }
    try {
      const res = await smartParseMut.mutateAsync({
        text: rawText,
        defaultSkill: skill,
        examType,
      });
      setParseResult(res);
      setEditableQuestions(res.questions ?? []);
      setEditableAnswers(res.answers ?? {});
      setEditablePassage(res.passageText ?? "");
      setEditableInstructions(res.instructions ?? "");
      toast.success(`${res.questions?.length ?? 0} ta savol muvaffaqiyatli ajratildi!`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Matnni tahlil qilishda xatolik yuz berdi");
    }
  }

  async function handleCommitSmartImport() {
    if (editableQuestions.length === 0) {
      toast.error("Saqlash uchun kamida 1 ta savol bo'lishi kerak");
      return;
    }
    try {
      const preparedQuestions = editableQuestions.map((q) => {
        const ans = editableAnswers[String(q.number)]?.trim();
        return {
          ...q,
          correctAnswers: ans
            ? ans
                .split(/[/;]+/)
                .map((x) => x.trim())
                .filter(Boolean)
            : (q.correctAnswers ?? []),
        };
      });

      if (targetScope === "group" && groupId) {
        const res = await groupBulkMut.mutateAsync({
          groupId,
          text: rawText,
          questions: preparedQuestions,
          answers: editableAnswers,
          passageText: editablePassage || undefined,
          instructions: editableInstructions || undefined,
          replaceExisting,
        });
        toast.success(`${res.added ?? preparedQuestions.length} ta savol guruhga saqlandi!`);
        onImported?.(res.questions as ImportedServerQuestion[] | undefined);
      } else {
        const res = await examBulkMut.mutateAsync({
          skill,
          text: rawText,
          questions: preparedQuestions,
          answers: editableAnswers,
          passageText: editablePassage || undefined,
          instructions: editableInstructions || undefined,
          replaceExisting,
        });
        toast.success(`${res.added ?? preparedQuestions.length} ta savol imtihonga saqlandi!`);
        onImported?.(res.questions as ImportedServerQuestion[] | undefined);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Bazaga saqlashda xatolik yuz berdi");
    }
  }

  async function handleDownloadExcelTemplate() {
    setDownloadingTemplate(true);
    try {
      const { blob, filename } = await api.downloadBlob("/mock/import-template/excel", {
        examType,
        skill,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `bestway_${examType}_${skill}_template.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Excel (.xlsx) shablon yuklab olindi");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Shablonni yuklab olishda xatolik");
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleUploadExcel() {
    if (!excelFile) {
      toast.error("Avval .xlsx yoki .csv faylni tanlang");
      return;
    }
    const form = new FormData();
    form.append("file", excelFile);
    form.append("skill", skill);
    if (targetScope === "group" && groupId) {
      form.append("groupId", groupId);
    }
    form.append("replaceExisting", String(replaceExisting));

    try {
      const res = await excelImportMut.mutateAsync(form);
      toast.success(`${res.added ?? 0} ta savol Excel jadvalidan muvaffaqiyatli yuklandi!`);
      onImported?.(res.questions as ImportedServerQuestion[] | undefined);
      setExcelFile(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Excel faylni yuklashda xatolik");
    }
  }

  async function handleSaveTimestamps() {
    const timestamps: AudioTimestampItem[] = timestampRows.map((row) => ({
      partNumber: row.partNumber,
      groupId: row.groupId,
      label: row.label,
      startSec: parseMmSsToSeconds(row.startMmSs),
      endSec: row.endMmSs.trim() ? parseMmSsToSeconds(row.endMmSs) : undefined,
    }));

    try {
      if (audioFile) {
        const form = new FormData();
        form.append("audio", audioFile);
        if (audioDurationSec != null) {
          form.append("durationSec", String(Math.round(audioDurationSec)));
        }
        form.append("timestamps", JSON.stringify(timestamps));
        await saveTimestampsMut.mutateAsync(form);
      } else {
        await saveTimestampsMut.mutateAsync({
          audioUrl: timestampsQ.data?.audioUrl ?? undefined,
          durationSec: audioDurationSec ? Math.round(audioDurationSec) : undefined,
          timestamps,
        });
      }
      toast.success("Yagona audio va Part vaqt belgilari (timestamps) saqlandi!");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Timestamps saqlashda xatolik yuz berdi");
    }
  }

  const playableAudioSrc =
    localAudioUrl ||
    (timestampsQ.data?.audioUrl ? `/api/backend${timestampsQ.data.audioUrl.startsWith("/") ? "" : "/"}${timestampsQ.data.audioUrl}` : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden border-border bg-surface">
        <DialogHeader className="border-b border-border bg-bg-subtle/80 px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="brand" className="gap-1">
                <Sparkles className="size-3.5" />
                Tezkor Kiritish v0.8
              </Badge>
              <Badge variant="info">
                {examType === "multilevel" ? "Multi-Level (0–75)" : "IELTS Academic / General"}
              </Badge>
              {groupLabel && <Badge variant="neutral">{groupLabel}</Badge>}
            </div>
          </div>
          <DialogTitle className="mt-1.5 text-lg font-bold text-fg">
            Savollarni Ommaviy Kiritish (Smart Text / Excel / Yagona Audio)
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            40 tagacha savolni Word/PDF matnidan avtomatik ajratib olish, Excel (.xlsx) shablondan yuklash yoki Listening uchun yagona audio fayl vaqtlari (timestamps) ni belgilash.
          </DialogDescription>

          {/* Tabs */}
          <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl border border-border bg-bg p-1">
            <button
              type="button"
              onClick={() => setActiveTab("smart-text")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "smart-text"
                  ? "bg-brand text-brand-fg shadow-xs"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <Wand2 className="size-3.5" />
              <span>1. Smart Text Parser</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("excel")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "excel"
                  ? "bg-brand text-brand-fg shadow-xs"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <FileSpreadsheet className="size-3.5" />
              <span>2. Excel / CSV (.xlsx)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("audio-timestamps")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "audio-timestamps"
                  ? "bg-brand text-brand-fg shadow-xs"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <Headphones className="size-3.5" />
              <span>3. Yagona Audio & Timestamps</span>
            </button>
          </div>
        </DialogHeader>

        <DialogBody className="max-h-[72vh] overflow-y-auto px-6 py-4 space-y-4">
          {/* Common scope controls for Tab 1 & Tab 2 */}
          {activeTab !== "audio-timestamps" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-subtle/60 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-medium text-fg">
                  <span>Bo&apos;lim (Skill):</span>
                  <select
                    value={skill}
                    onChange={(e) => setSkill(e.target.value as "reading" | "listening")}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-fg"
                  >
                    <option value="reading">Reading (O&apos;qish)</option>
                    <option value="listening">Listening (Tinglash)</option>
                  </select>
                </label>

                {groupId && (
                  <label className="flex items-center gap-2 text-xs font-medium text-fg">
                    <span>Qayerga:</span>
                    <select
                      value={targetScope}
                      onChange={(e) => setTargetScope(e.target.value as "exam" | "group")}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-fg"
                    >
                      <option value="group">Faqat joriy qismga ({groupLabel || "Group"})</option>
                      <option value="exam">Butun {skill} bo&apos;limiga (Partlarga bo&apos;lib)</option>
                    </select>
                  </label>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-fg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="size-4 rounded border-border accent-brand"
                />
                <span>Mavjud savollarni almashtirish (Replace)</span>
              </label>
            </div>
          )}

          {/* TAB 1: SMART TEXT PARSER */}
          {activeTab === "smart-text" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="smart-raw-text" className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                    Word yoki PDF dan ko&apos;chirilgan matn (Passage + 1..40 Savollar + Answers)
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setRawText(SAMPLE_SMART_TEXT)}
                      className="h-7 text-xs"
                    >
                      <FileText className="size-3.5 mr-1" />
                      Namuna matn qo&apos;yish
                    </Button>
                    {rawText && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRawText("");
                          setParseResult(null);
                          setEditableQuestions([]);
                        }}
                        className="h-7 text-xs text-fg-muted"
                      >
                        Tozalash
                      </Button>
                    )}
                  </div>
                </div>

                <Textarea
                  id="smart-raw-text"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="1. Savol matni...\nA) Variant 1\nB) Variant 2\nC) Variant 3\n\n2. True/False savol...\nTRUE / FALSE / NOT GIVEN\n\nAnswers:\n1: B\n2: TRUE"
                  className="min-h-44 font-mono text-xs leading-relaxed"
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-fg-subtle">
                    Avto-aniqlash: Multiple Choice (A–D), TFNG / YNNG, Matching va Bo&apos;sh joyni to&apos;ldirish (___).
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSmartParse()}
                    loading={smartParseMut.isPending}
                  >
                    <Wand2 className="size-4 mr-1.5" />
                    Matnni tahlil qilish (Parse)
                  </Button>
                </div>
              </div>

              {parseResult && (
                <div className="space-y-3 rounded-xl border border-brand/30 bg-bg-subtle/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-emerald-500" />
                      <span className="text-sm font-bold text-fg">
                        Tahlil natijasi: {editableQuestions.length} ta savol topildi
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(
                        editableQuestions.reduce<Record<string, number>>((acc, q) => {
                          acc[q.type] = (acc[q.type] ?? 0) + 1;
                          return acc;
                        }, {}),
                      ).map(([type, count]) => {
                        const meta = QUESTION_TYPE_BADGE[type] ?? {
                          label: type,
                          variant: "neutral" as const,
                        };
                        return (
                          <Badge key={type} variant={meta.variant}>
                            {meta.label}: {count}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  {editablePassage && (
                    <Field label="Ajratib olingan Reading matni (Passage)" htmlFor="smart-passage">
                      <Textarea
                        id="smart-passage"
                        value={editablePassage}
                        onChange={(e) => setEditablePassage(e.target.value)}
                        className="min-h-24 text-xs"
                      />
                    </Field>
                  )}

                  {/* Interactive preview table */}
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 border-b border-border bg-bg-subtle text-[11px] font-bold uppercase text-fg-muted">
                        <tr>
                          <th className="px-3 py-2 w-14">#</th>
                          <th className="px-3 py-2 w-40">Savol turi</th>
                          <th className="px-3 py-2">Savol matni va variantlar</th>
                          <th className="px-3 py-2 w-36">To&apos;g&apos;ri javob</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {editableQuestions.map((q, idx) => {
                          const ansVal =
                            editableAnswers[String(q.number)] ??
                            (q.correctAnswers && q.correctAnswers.length > 0
                              ? q.correctAnswers.join(" / ")
                              : "");
                          const badgeMeta = QUESTION_TYPE_BADGE[q.type] ?? {
                            label: q.type,
                            variant: "neutral" as const,
                          };
                          return (
                            <tr key={`${q.number}-${idx}`} className="hover:bg-surface-hover/60">
                              <td className="px-3 py-2 font-bold tabular-nums text-fg">
                                Q{q.number}
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={q.type}
                                  onChange={(e) => {
                                    const nextType = e.target.value as MockQuestionType;
                                    setEditableQuestions((prev) =>
                                      prev.map((item, i) =>
                                        i === idx ? { ...item, type: nextType } : item,
                                      ),
                                    );
                                  }}
                                  className="w-full rounded border border-border bg-bg px-2 py-1 text-[11px] font-medium text-fg"
                                >
                                  {Object.entries(QUESTION_TYPE_BADGE).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v.label}
                                    </option>
                                  ))}
                                </select>
                                <div className="mt-1">
                                  <Badge variant={badgeMeta.variant} className="text-[10px]">
                                    {badgeMeta.label}
                                  </Badge>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  value={q.prompt}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditableQuestions((prev) =>
                                      prev.map((item, i) =>
                                        i === idx ? { ...item, prompt: val } : item,
                                      ),
                                    );
                                  }}
                                  className="h-8 text-xs"
                                />
                                {q.options && q.options.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {q.options.map((opt, oi) => (
                                      <span
                                        key={oi}
                                        className="rounded bg-bg-subtle px-1.5 py-0.5 text-[11px] text-fg-muted"
                                      >
                                        <strong>{String.fromCharCode(65 + oi)})</strong> {opt}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  value={ansVal}
                                  placeholder="Javob kaliti"
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditableAnswers((prev) => ({
                                      ...prev,
                                      [String(q.number)]: val,
                                    }));
                                  }}
                                  className={`h-8 text-xs font-semibold ${
                                    !ansVal.trim() ? "border-warning" : "border-emerald-500/40"
                                  }`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: EXCEL / CSV IMPORT */}
          {activeTab === "excel" && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg-subtle/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-fg">
                    1-qadam: Tayyor 40 savollik Excel (.xlsx) shablonni yuklab oling
                  </h4>
                  <p className="text-xs text-fg-muted">
                    Shablonda savol raqami, turi, savol matni, A/B/C/D variantlar va to&apos;g&apos;ri javob ustunlari tayyorlangan.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={downloadingTemplate}
                  onClick={() => void handleDownloadExcelTemplate()}
                  className="shrink-0"
                >
                  <Download className="size-4 mr-1.5" />
                  Shablonni yuklab olish (.xlsx)
                </Button>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) setExcelFile(f);
                }}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border-strong bg-bg-subtle/30 p-8 text-center transition hover:border-brand"
              >
                <FileSpreadsheet className="size-10 text-emerald-500" />
                <p className="mt-2 text-sm font-bold text-fg">
                  2-qadam: To&apos;ldirilgan Excel (.xlsx) yoki CSV faylni shu yerga tashlang
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  Barcha 40 ta savol va javob kalitlari bitta tugma bilan bazaga joylanadi
                </p>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setExcelFile(f);
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => excelInputRef.current?.click()}
                >
                  <Upload className="size-4 mr-1.5" />
                  {excelFile ? "Boshqa fayl tanlash" : "Fayl tanlash (.xlsx / .csv)"}
                </Button>
                {excelFile && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    <span>{excelFile.name}</span>
                    <span className="text-fg-muted">
                      ({(excelFile.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SINGLE AUDIO & TIMESTAMPS */}
          {activeTab === "audio-timestamps" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-bg-subtle/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-fg flex items-center gap-2">
                      <Music className="size-4 text-brand" />
                      Yagona Listening Audio Fayli
                    </h4>
                    <p className="text-xs text-fg-muted">
                      Audioni 4–6 bo&apos;lakka qirqish shart emas: bitta to&apos;liq audio yuklang va har bir Part boshlanish vaqtini belgilang.
                    </p>
                  </div>
                  <div>
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
                        setLocalAudioUrl(URL.createObjectURL(f));
                        setAudioFile(f);
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => audioInputRef.current?.click()}
                    >
                      <Upload className="size-4 mr-1.5" />
                      {audioFile || playableAudioSrc ? "Audioni almashtirish" : "Yagona Audio yuklash"}
                    </Button>
                  </div>
                </div>

                {audioFile && (
                  <p className="text-xs text-emerald-400 font-medium">
                    Tanlangan fayl: {audioFile.name} ({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </p>
                )}

                {playableAudioSrc && (
                  <div className="space-y-1.5">
                    <audio
                      ref={audioPlayerRef}
                      controls
                      src={playableAudioSrc}
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (Number.isFinite(d) && d > 0) {
                          setAudioDurationSec(Math.round(d));
                        }
                      }}
                      className="w-full h-10"
                    />
                    <p className="text-[11px] text-fg-subtle">
                      Maslahat: Audioni eshitib ko&apos;rib, kerakli joyda to&apos;xtating va &ldquo;Joriy vaqtni olish&rdquo; tugmasini bosing.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    Partlar bo&apos;yicha vaqt belgilari (Start / End Timestamps)
                  </h4>
                  {timestampsQ.isLoading && <Loader2 className="size-4 animate-spin text-fg-muted" />}
                </div>

                <div className="divide-y divide-border rounded-xl border border-border bg-surface overflow-hidden">
                  {timestampRows.map((row, idx) => (
                    <div
                      key={row.partNumber}
                      className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Badge variant="info" className="shrink-0">
                          Part {row.partNumber}
                        </Badge>
                        <Input
                          value={row.label}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTimestampRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, label: val } : r)),
                            );
                          }}
                          className="h-8 text-xs max-w-52"
                          placeholder={`Part ${row.partNumber} sarlavhasi`}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-fg-muted">Boshlanishi (MM:SS):</span>
                          <Input
                            value={row.startMmSs}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTimestampRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, startMmSs: val } : r)),
                              );
                            }}
                            placeholder="00:00"
                            className="h-8 w-24 font-mono text-xs text-center"
                          />
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-fg-muted">Tugashi:</span>
                          <Input
                            value={row.endMmSs}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTimestampRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, endMmSs: val } : r)),
                              );
                            }}
                            placeholder="07:00"
                            className="h-8 w-24 font-mono text-xs text-center"
                          />
                        </div>

                        {playableAudioSrc && (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-xs"
                              title="Pleerdagi joriy vaqtni Boshlanish vaqtiga yozish"
                              onClick={() => {
                                const cur = audioPlayerRef.current?.currentTime ?? 0;
                                setTimestampRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, startMmSs: formatSecondsToMmSs(cur) } : r,
                                  ),
                                );
                              }}
                            >
                              Joriy vaqt
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              title="Shu Part boshlanish vaqtidan eshitib ko'rish"
                              onClick={() => {
                                const el = audioPlayerRef.current;
                                if (!el) return;
                                el.currentTime = parseMmSsToSeconds(row.startMmSs);
                                void el.play();
                              }}
                            >
                              <Play className="size-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="border-t border-border bg-bg-subtle/60 px-6 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Bekor qilish
          </Button>

          {activeTab === "smart-text" && (
            <Button
              type="button"
              size="sm"
              disabled={editableQuestions.length === 0}
              loading={examBulkMut.isPending || groupBulkMut.isPending}
              onClick={() => void handleCommitSmartImport()}
            >
              <Upload className="size-4 mr-1.5" />
              Bazaga saqlash ({editableQuestions.length} savol)
            </Button>
          )}

          {activeTab === "excel" && (
            <Button
              type="button"
              size="sm"
              disabled={!excelFile}
              loading={excelImportMut.isPending}
              onClick={() => void handleUploadExcel()}
            >
              <Upload className="size-4 mr-1.5" />
              Excel jadvalni bazaga yuklash
            </Button>
          )}

          {activeTab === "audio-timestamps" && (
            <Button
              type="button"
              size="sm"
              loading={saveTimestampsMut.isPending}
              onClick={() => void handleSaveTimestamps()}
            >
              <CheckCircle2 className="size-4 mr-1.5" />
              Audio va Timestampsni saqlash
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
