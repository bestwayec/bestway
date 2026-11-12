"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Sparkles,
  Trash2,
  X,
  Upload,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export interface WordItem {
  id?: string;
  english: string;
  uzbek: string;
  part_of_speech?: string;
  context_sentence?: string;
}

export interface VocabularyBuilderProps {
  groupId?: string;
  onSuccess?: (createdSet: any) => void;
  onCancel?: () => void;
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "IELTS", "MULTILEVEL"];

export function VocabularyBuilder({ groupId, onSuccess, onCancel }: VocabularyBuilderProps) {
  const t = useTranslations("vocabularyBuilder");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [level, setLevel] = React.useState("B1");
  const [isPublic, setIsPublic] = React.useState(true);
  const [words, setWords] = React.useState<WordItem[]>([]);

  // Single word inputs
  const [engInput, setEngInput] = React.useState("");
  const [uzbInput, setUzbInput] = React.useState("");
  const [posInput, setPosInput] = React.useState("");
  const [contextInput, setContextInput] = React.useState("");

  // Smart Paste Modal state
  const [isSmartPasteOpen, setIsSmartPasteOpen] = React.useState(false);
  const [rawPasteText, setRawPasteText] = React.useState("");
  const [parsedPreview, setParsedPreview] = React.useState<WordItem[]>([]);
  const [isParsing, setIsParsing] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const handleAddSingleWord = () => {
    if (!engInput.trim() || !uzbInput.trim()) return;
    const newWord: WordItem = {
      english: engInput.trim(),
      uzbek: uzbInput.trim(),
      part_of_speech: posInput.trim() || undefined,
      context_sentence: contextInput.trim() || undefined,
    };
    setWords((prev) => [...prev, newWord]);
    setEngInput("");
    setUzbInput("");
    setPosInput("");
    setContextInput("");
  };

  const handleRemoveWord = (index: number) => {
    setWords((prev) => prev.filter((_, i) => i !== index));
  };

  const handleParseRawText = async () => {
    if (!rawPasteText.trim()) return;
    setIsParsing(true);
    try {
      const res = await api.post<{ words: WordItem[]; count: number }>("/v1/vocabulary/sets/parse-text", {
        rawText: rawPasteText,
      });
      setParsedPreview(res.words || []);
    } catch (err: any) {
      // Fallback local regex parsing if backend offline
      const lines = rawPasteText.trim().split("\n");
      const fallbackList: WordItem[] = [];
      for (const line of lines) {
        const clean = line.replace(/^\s*(?:\d+[\.\)]|[-•*])\s*/, "").trim();
        const parts = clean.split(/\s*[-—–:=]\s*/);
        if (parts.length >= 2 && parts[0] && parts[1]) {
          fallbackList.push({ english: parts[0].trim(), uzbek: parts[1].trim() });
        }
      }
      setParsedPreview(fallbackList);
    } finally {
      setIsParsing(false);
    }
  };

  const handleApplySmartPaste = () => {
    if (parsedPreview.length > 0) {
      setWords((prev) => [...prev, ...parsedPreview]);
      setParsedPreview([]);
      setRawPasteText("");
      setIsSmartPasteOpen(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setErrorMsg(t("needTitle"));
      return;
    }
    if (words.length === 0) {
      setErrorMsg(t("needWord"));
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        level,
        groupId: groupId || undefined,
        isPublic,
        words,
      };
      const res = await api.post<any>("/v1/vocabulary/sets", payload);
      if (onSuccess) {
        onSuccess(res);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t("saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-fg flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-brand" />
            {t("title")}
          </h2>
          <p className="text-sm text-fg-muted mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsSmartPasteOpen(true)}
            className="border-brand/40 text-brand hover:bg-brand-hover/10"
          >
            <Sparkles className="mr-2 h-4 w-4 text-brand" />
            {t("smartPaste")}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("cancel")}
            </Button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-danger/10 p-4 text-sm text-danger border border-danger/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Meta Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-2">
          <label htmlFor="vb-title" className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            {t("setTitle")}
          </label>
          <Input
            id="vb-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("setTitlePlaceholder")}
            className="bg-bg"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="vb-level" className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            {t("level")}
          </label>
          <select
            id="vb-level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-bg text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="vb-description" className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {t("description")}
        </label>
        <Input
          id="vb-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("descriptionPlaceholder")}
          className="bg-bg"
        />
      </div>

      {/* Add single word row */}
      <div className="rounded-xl border border-dashed border-border bg-bg-subtle/30 p-4 space-y-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {t("addWord")}
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <Input
            value={engInput}
            onChange={(e) => setEngInput(e.target.value)}
            placeholder={t("englishPlaceholder")}
            aria-label={t("colEnglish")}
            className="bg-bg"
          />
          <Input
            value={uzbInput}
            onChange={(e) => setUzbInput(e.target.value)}
            placeholder={t("uzbekPlaceholder")}
            aria-label={t("colUzbek")}
            className="bg-bg"
          />
          <Input
            value={posInput}
            onChange={(e) => setPosInput(e.target.value)}
            placeholder={t("posPlaceholder")}
            aria-label={t("colPos")}
            className="bg-bg"
          />
          <div className="flex gap-2">
            <Input
              value={contextInput}
              onChange={(e) => setContextInput(e.target.value)}
              placeholder={t("contextPlaceholder")}
              aria-label={t("colContext")}
              className="bg-bg flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleAddSingleWord()}
            />
            <Button
              type="button"
              onClick={handleAddSingleWord}
              aria-label={t("addWordButton")}
              disabled={!engInput.trim() || !uzbInput.trim()}
              className="bg-brand hover:bg-brand-hover text-brand-fg shrink-0"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Words List Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
            <span>{t("wordsTitle")}</span>
            <Badge variant="neutral" className="border-brand/40 text-brand">
              {t("wordCount", { count: words.length })}
            </Badge>
          </h3>
          {words.length > 0 && (
            <button
              type="button"
              onClick={() => setWords([])}
              className="text-xs text-danger hover:underline"
            >
              {t("clearAll")}
            </button>
          )}
        </div>

        {words.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-fg-muted">
            {t("emptyWords")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border max-h-80 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-subtle text-fg-muted sticky top-0 z-10 text-xs uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">#</th>
                  <th className="py-2.5 px-4 font-semibold">{t("colEnglish")}</th>
                  <th className="py-2.5 px-4 font-semibold">{t("colUzbek")}</th>
                  <th className="py-2.5 px-4 font-semibold">{t("colPos")}</th>
                  <th className="py-2.5 px-4 font-semibold">{t("colContext")}</th>
                  <th className="py-2.5 px-4 font-semibold text-right">{t("colAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {words.map((w, idx) => (
                  <tr key={idx} className="hover:bg-bg-subtle/50 transition-colors">
                    <td className="py-2.5 px-4 text-fg-muted font-mono text-xs">{idx + 1}</td>
                    <td className="py-2.5 px-4 font-medium text-fg">{w.english}</td>
                    <td className="py-2.5 px-4 text-brand font-medium">{w.uzbek}</td>
                    <td className="py-2.5 px-4 text-xs text-fg-muted">{w.part_of_speech || "—"}</td>
                    <td className="py-2.5 px-4 text-xs text-fg-muted max-w-xs truncate">
                      {w.context_sentence || "—"}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveWord(idx)}
                        className="text-fg-muted hover:text-danger transition-colors p-1"
                        aria-label={t("removeWord", { word: w.english })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer Submit */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="rounded border-input text-brand focus:ring-brand h-4 w-4"
          />
          {t("public")}
        </label>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || words.length === 0}
          className="bg-brand hover:bg-brand-hover text-brand-fg px-6 font-semibold shadow-lg shadow-brand/20"
        >
          {isSubmitting ? t("saving") : t("publish")}
        </Button>
      </div>

      {/* Smart Paste Dialog */}
      {isSmartPasteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-lg font-bold text-fg flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-brand" />
                {t("smartPaste")}
              </h3>
              <button
                type="button"
                aria-label={t("cancel")}
                onClick={() => setIsSmartPasteOpen(false)}
                className="text-fg-muted hover:text-fg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-fg-muted leading-relaxed">
              {t("pasteHint")} <code>apple - olma</code>, <code>1. banana : banan</code>, <code>• car = mashina</code>
            </p>

            <textarea
              rows={8}
              value={rawPasteText}
              onChange={(e) => setRawPasteText(e.target.value)}
              aria-label={t("smartPaste")}
              placeholder={`${t("pasteExample")}\n1. environment - atrof-muhit\n2. pollution — ifloslanish\n• recycle : qayta ishlamoq\nresilient [adj] (e.g. He is very resilient) - chidamli`}
              className="w-full rounded-xl border border-input bg-bg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand resize-none"
            />

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={handleParseRawText}
                disabled={isParsing || !rawPasteText.trim()}
                className="border-brand/40 text-brand"
              >
                {isParsing ? t("parsing") : t("parse")}
              </Button>
              {parsedPreview.length > 0 && (
                <span className="text-xs font-semibold text-brand">
                  {parsedPreview.length > 15 ? t("foundPreview", { count: parsedPreview.length, shown: 15 }) : t("found", { count: parsedPreview.length })}
                </span>
              )}
            </div>

            {parsedPreview.length > 0 && (
              <div className="flex-1 overflow-y-auto max-h-48 border border-border rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg-subtle text-fg-muted sticky top-0">
                    <tr>
                      <th className="py-2 px-3">{t("colEnglish")}</th>
                      <th className="py-2 px-3">{t("colUzbek")}</th>
                      <th className="py-2 px-3">{t("colPos")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {parsedPreview.slice(0, 15).map((p, i) => (
                      <tr key={i}>
                        <td className="py-1.5 px-3 font-medium text-fg">{p.english}</td>
                        <td className="py-1.5 px-3 text-brand font-medium">{p.uzbek}</td>
                        <td className="py-1.5 px-3 text-fg-muted">{p.part_of_speech || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={() => setIsSmartPasteOpen(false)}>
                {t("cancel")}
              </Button>
              <Button
                type="button"
                disabled={parsedPreview.length === 0}
                onClick={handleApplySmartPaste}
                className="bg-brand hover:bg-brand-hover text-brand-fg"
              >
                {t("addParsed", { count: parsedPreview.length })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
