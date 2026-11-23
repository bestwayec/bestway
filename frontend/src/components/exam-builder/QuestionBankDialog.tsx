"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Headphones, Image as ImageIcon, Library, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBankInsert, useQuestionBank, type BankGroup } from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamType, MockSkill } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tx } from "./types";

const QUESTION_TYPES = [
  "multiple_choice", "multi_select", "true_false_notgiven", "yes_no_notgiven", "matching", "matching_headings",
  "sentence_completion", "note_completion", "summary_completion", "table_completion", "short_answer", "map_labelling",
  "essay_task1", "essay_task2", "speaking_task",
] as const;
const SKILLS: MockSkill[] = ["listening", "reading", "writing", "speaking"];
const ANY = "__any__";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Pick reusable question groups from the bank (the actor's own exams; admins see all) and copy
 * them into this draft. Whole groups are copied so passages, audio, instructions and option banks
 * stay with their questions; numbers continue after the section's last question. The source exam
 * is never changed. Answer keys are never sent to the browser here — the copy happens server-side.
 */
export function QuestionBankDialog({
  open,
  onClose,
  examId,
  examType,
  defaultSkill,
  onInserted,
}: {
  open: boolean;
  onClose: () => void;
  examId: string;
  examType: MockExamType;
  defaultSkill?: MockSkill;
  onInserted?: () => void;
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const [search, setSearch] = React.useState("");
  const [skill, setSkill] = React.useState<string>(defaultSkill ?? ANY);
  const [type, setType] = React.useState<string>(ANY);
  const [tag, setTag] = React.useState("");
  const [cefr, setCefr] = React.useState<string>(ANY);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 300);
  const debouncedTag = useDebounced(tag, 300);
  const family = examType === "multilevel" ? "multilevel" : undefined;

  const bank = useQuestionBank(
    {
      search: debouncedSearch.trim(),
      section: skill === ANY ? undefined : skill,
      type: type === ANY ? undefined : type,
      tag: debouncedTag.trim().toLowerCase(),
      cefrLevel: cefr === ANY ? undefined : cefr,
      examType: family,
    },
    open,
  );
  const insert = useBankInsert(examId);
  // IELTS Academic and General share question rules; Multilevel never mixes with IELTS (server enforces).
  const items = (bank.data?.items ?? []).filter((g) => (examType === "multilevel") === (g.examType === "multilevel"));

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function close() {
    if (insert.isPending) return;
    setSelected([]);
    setExpanded(null);
    onClose();
  }

  function submit() {
    insert.mutate(selected, {
      onSuccess: (result) => {
        const questions = result.inserted.reduce((total, g) => total + g.numbers.length, 0);
        toast.success(
          tx(t, "bankInserted", "Added {groups} group(s), {questions} question(s) to this draft.", {
            groups: result.inserted.length,
            questions,
          }),
        );
        if (result.inserted.some((g) => g.partNumberDropped)) {
          toast.info(tx(t, "bankPartDropped", "A Listening part number was already used here — set the part number on the copied group."));
        }
        onInserted?.();
        setSelected([]);
        onClose();
      },
      onError: (e) => toast.error(e instanceof ApiError ? `${e.message} (${e.code})` : tc("unknownError")),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[min(94dvh,900px)] max-w-3xl flex-col overflow-hidden max-sm:max-h-[94dvh]" data-testid="question-bank-dialog">
        <DialogHeader className="shrink-0 border-b border-border pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Library className="size-5 text-brand" aria-hidden />
            {tx(t, "bankTitle", "Question bank")}
          </DialogTitle>
          <DialogDescription>
            {tx(t, "bankHint", "Reuse question groups from your exams. Each group is copied with its passage or audio, instructions, options and answer keys; numbering continues after this section's last question. The original exam is not changed.")}
          </DialogDescription>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label className="relative sm:col-span-2">
              <span className="sr-only">{tx(t, "bankSearch", "Search questions")}</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tx(t, "bankSearchPlaceholder", "Search prompt, passage, title…")}
                className="h-10 w-full rounded-field border border-border bg-bg pl-8 pr-3 text-sm"
              />
            </label>
            <Select value={skill} onValueChange={setSkill}>
              <SelectTrigger aria-label={tx(t, "bankSkill", "Skill")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{tx(t, "bankAnySkill", "Any skill")}</SelectItem>
                {SKILLS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label={tx(t, "bankType", "Question type")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{tx(t, "bankAnyType", "Any question type")}</SelectItem>
                {QUESTION_TYPES.map((q) => <SelectItem key={q} value={q}>{q.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={cefr} onValueChange={setCefr}>
              <SelectTrigger aria-label="CEFR"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{tx(t, "bankAnyLevel", "Any level")}</SelectItem>
                {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              aria-label={tx(t, "bankTopic", "Topic tag")}
              placeholder={tx(t, "bankTopicPlaceholder", "Topic tag, e.g. environment")}
              className="h-10 w-full rounded-field border border-border bg-bg px-3 text-sm sm:col-span-2 lg:col-span-5"
            />
          </div>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 overflow-y-auto py-3">
          {bank.isLoading ? (
            <p className="text-sm text-fg-muted" role="status">{tx(t, "bankLoading", "Loading the bank…")}</p>
          ) : bank.isError ? (
            <p className="text-sm text-danger" role="alert">{tc("unknownError")}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-fg-muted">{tx(t, "bankEmpty", "No reusable groups match. Only groups from your own exams (all exams for admins) are listed.")}</p>
          ) : (
            <ul className="space-y-2" aria-label={tx(t, "bankResults", "Matching question groups")}>
              {items.map((g) => (
                <BankRow
                  key={g.groupId}
                  group={g}
                  selected={selected.includes(g.groupId)}
                  expanded={expanded === g.groupId}
                  onToggle={() => toggle(g.groupId)}
                  onExpand={() => setExpanded((cur) => (cur === g.groupId ? null : g.groupId))}
                />
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter className="shrink-0 border-t border-border bg-surface pt-3">
          <Button variant="outline" onClick={close} className="min-h-10 justify-center">{tc("close")}</Button>
          <Button onClick={submit} disabled={selected.length === 0 || insert.isPending} loading={insert.isPending} className="min-h-10 justify-center">
            {tx(t, "bankAdd", "Add {count} group(s) to this draft", { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BankRow({
  group,
  selected,
  expanded,
  onToggle,
  onExpand,
}: {
  group: BankGroup;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const t = useTranslations("examBuilder");
  const numbers = group.questions.map((q) => q.number);
  return (
    <li className={cn("rounded-control border p-3", selected ? "border-brand bg-brand/5" : "border-border")}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
          aria-label={tx(t, "bankSelect", "Select {title}", { title: group.title || group.examTitle })}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{group.title || tx(t, "bankUntitled", "Untitled group")}</p>
          <p className="truncate text-xs text-fg-muted">
            {group.examTitle} · <span className="capitalize">{group.skill}</span>
            {group.partNumber != null && ` · Part ${group.partNumber}`} · {group.questionCount} {tx(t, "questions", "questions")}
            {numbers.length > 0 && ` · Q${Math.min(...numbers)}–${Math.max(...numbers)}`}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {[...new Set(group.questions.map((q) => q.type))].map((type) => (
              <Badge key={type} variant="neutral" className="text-[11px]">{type.replace(/_/g, " ")}</Badge>
            ))}
            {group.hasAudio && <Badge variant="info" className="text-[11px]"><Headphones className="mr-1 size-3" aria-hidden />audio</Badge>}
            {group.hasImage && <Badge variant="info" className="text-[11px]"><ImageIcon className="mr-1 size-3" aria-hidden />image</Badge>}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onExpand} aria-expanded={expanded} className="shrink-0">
          {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
          <span className="max-sm:sr-only">{tx(t, "preview", "Preview")}</span>
        </Button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-border pt-2 text-xs">
          {group.instructions && <p className="whitespace-pre-line text-fg-muted">{group.instructions}</p>}
          {group.passageExcerpt && <p className="line-clamp-4 whitespace-pre-line italic text-fg-muted">{group.passageExcerpt}…</p>}
          <ol className="space-y-1">
            {group.questions.map((q) => (
              <li key={q.number}>
                <span className="font-semibold tabular-nums">Q{q.number}.</span> {q.prompt}
                {q.options.length > 0 && (
                  <span className="block pl-5 text-fg-muted">{q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("   ")}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}
