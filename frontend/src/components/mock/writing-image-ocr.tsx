"use client";

import { countWords } from "@/lib/writing-rules";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  FileImage,
  Loader2,
  Maximize2,
  RefreshCw,
  ScanText,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { WritingOcrResponse } from "@/hooks/use-mock";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per image
const DEFAULT_MAX_PAGES = 5;

export interface WritingPageItem {
  id: string;
  file?: File;
  previewUrl: string;
  name: string;
  sizeBytes?: number;
  uploadedUrl?: string;
}

export interface WritingImageOcrProps {
  attemptId: string;
  questionId: string;
  /** Called when OCR text is extracted so parent can populate the essay textarea */
  onExtractedText: (ocrText: string, mode: "replace" | "append") => void;
  /** Current text in the essay textarea (used to offer append/replace when non-empty) */
  currentText?: string;
  /** Optional initial image URLs from a saved attempt */
  initialImageUrls?: string[];
  /** Max pages allowed (default 5) */
  maxPages?: number;
  /** Custom OCR endpoint override */
  ocrEndpoint?: string;
  className?: string;
}

/** Interactive Lightbox Zoom Modal for inspecting handwriting */
export function ImageZoomModal({
  url,
  title,
  onClose,
}: {
  url: string | null;
  title?: string;
  onClose: () => void;
}) {
  const t = useTranslations("mock.ocr");
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    setZoomLevel(1);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-in fade-in"
      onClick={onClose}
    >
      {/* Top Toolbar */}
      <div
        className="flex w-full max-w-4xl items-center justify-between gap-3 border-b border-border bg-bg-subtle/90 px-4 py-2.5 text-fg rounded-t-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-semibold truncate text-fg">
          {title || t("zoomTitle")}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="size-8 p-0 border-border-strong bg-surface-hover text-fg hover:bg-border-strong"
            onClick={() => setZoomLevel((z) => Math.min(z + 0.3, 3))}
            title={t("zoomIn")}
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="size-8 p-0 border-border-strong bg-surface-hover text-fg hover:bg-border-strong"
            onClick={() => setZoomLevel((z) => Math.max(z - 0.3, 0.6))}
            title={t("zoomOut")}
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2.5 border-border-strong bg-surface-hover text-xs font-medium text-fg hover:bg-border-strong"
            onClick={() => setZoomLevel(1)}
          >
            {Math.round(zoomLevel * 100)}%
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="size-8 p-0 border-danger-border/60 bg-danger-bg/40 text-danger hover:bg-danger-bg/60"
            onClick={onClose}
            title={t("closeEsc")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Image Preview Canvas */}
      <div
        className="relative flex size-full max-w-4xl flex-1 items-center justify-center overflow-auto rounded-b-xl border border-border bg-[#05080F] p-4 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={title || t("pageAlt")}
          className="max-h-[80vh] max-w-full rounded-md object-contain shadow-2xl transition-transform duration-150"
          style={{ transform: `scale(${zoomLevel})` }}
        />
      </div>
    </div>
  );
}

export function WritingImageOcr({
  attemptId,
  questionId,
  onExtractedText,
  currentText = "",
  initialImageUrls,
  maxPages = DEFAULT_MAX_PAGES,
  ocrEndpoint,
  className,
}: WritingImageOcrProps) {
  const t = useTranslations("mock.ocr");
  const [pages, setPages] = useState<WritingPageItem[]>(() =>
    (initialImageUrls ?? []).slice(0, maxPages).map((url, idx) => ({
      id: `init-${idx}-${url}`,
      previewUrl: url,
      name: t("pageN", { n: idx + 1 }),
      uploadedUrl: url,
    })),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [lastExtractedCount, setLastExtractedCount] = useState<number | null>(null);
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null);
  const [zoomPage, setZoomPage] = useState<{ url: string; title: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => {
    return () => {
      for (const p of pagesRef.current) {
        if (p.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(p.previewUrl);
        }
      }
    };
  }, []);

  const validateFile = useCallback((file: File): string | null => {
    const validType =
      ALLOWED_MIME_TYPES.has(file.type.toLowerCase()) ||
      ALLOWED_EXTENSIONS.test(file.name);
    if (!validType) {
      return t("badFormat", { name: file.name });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return t("tooLarge", { name: file.name });
    }
    return null;
  }, [t]);

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      if (incoming.length === 0) return;

      const remainingSlots = maxPages - pages.length;
      if (remainingSlots <= 0) {
        toast.warning(t("maxPages", { max: maxPages }));
        return;
      }

      const filesToAdd = incoming.slice(0, remainingSlots);
      if (incoming.length > remainingSlots) {
        toast.info(t("partlyAdded", { added: remainingSlots, max: maxPages }));
      }

      const validNewPages: WritingPageItem[] = [];
      for (const file of filesToAdd) {
        const err = validateFile(file);
        if (err) {
          toast.error(err);
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        validNewPages.push({
          id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          previewUrl,
          name: file.name,
          sizeBytes: file.size,
        });
      }

      if (validNewPages.length > 0) {
        setPages((prev) => [...prev, ...validNewPages]);
        toast.success(t("pagesAdded", { count: validNewPages.length }));
      }
    },
    [maxPages, pages.length, validateFile, t],
  );

  const handleRemovePage = useCallback((index: number) => {
    setPages((prev) => {
      const target = prev[index];
      if (target?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((_, idx) => idx !== index);
    });
  }, []);

  const handleReplaceFile = useCallback(
    (index: number, newFile: File) => {
      const err = validateFile(newFile);
      if (err) {
        toast.error(err);
        return;
      }
      const previewUrl = URL.createObjectURL(newFile);
      setPages((prev) => {
        const next = [...prev];
        const old = next[index];
        if (old?.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(old.previewUrl);
        }
        next[index] = {
          id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file: newFile,
          previewUrl,
          name: newFile.name,
          sizeBytes: newFile.size,
        };
        return next;
      });
      toast.success(t("pageReplaced", { n: index + 1 }));
    },
    [validateFile, t],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer?.files?.length) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleExtractOcr = async (mode: "replace" | "append" = "replace") => {
    const filesToUpload = pages.filter((p) => p.file instanceof File);
    if (filesToUpload.length === 0 && pages.length === 0) {
      toast.error(t("needImage"));
      return;
    }

    setIsExtracting(true);
    try {
      const form = new FormData();
      for (const page of pages) {
        if (page.file) {
          form.append("images", page.file, page.file.name);
        } else if (page.uploadedUrl) {
          form.append("existingImageUrls", page.uploadedUrl);
        }
      }

      const endpoint =
        ocrEndpoint ?? `/api/v1/mock/attempts/${attemptId}/writing/${questionId}/ocr`;
      const result = await api.post<WritingOcrResponse>(endpoint, form);

      const extracted = (result?.ocrText ?? "").trim();
      if (!extracted) {
        toast.warning(t("noText"));
        return;
      }

      if (result?.imageUrls?.length) {
        setPages((prev) =>
          prev.map((p, idx) => ({
            ...p,
            uploadedUrl: result.imageUrls?.[idx] ?? p.uploadedUrl,
          })),
        );
      }

      const words = countWords(extracted);
      setLastExtractedCount(words);
      onExtractedText(extracted, mode);
      toast.success(t("read", { count: words }));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : t("failed");
      toast.error(msg);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-bg-subtle/90 p-4 shadow-xl backdrop-blur-xl transition-all",
        className,
      )}
      onDragStart={(e) => e.stopPropagation()}
    >
      {/* Hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && replacingIndex !== null) {
            handleReplaceFile(replacingIndex, file);
          }
          setReplacingIndex(null);
          e.target.value = "";
        }}
      />

      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-xl border border-brand/30 bg-brand-subtle/40 text-brand shadow-sm">
            <ScanText className="size-4" />
          </span>
          <div>
            <p className="text-xs font-bold text-fg flex items-center gap-1.5">
              <span>{t("title")}</span>
              <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-subtle-fg border border-brand/30">
                DeepSeek Vision
              </span>
            </p>
            <p className="text-[11px] text-fg-muted">{t("subtitle")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={isExtracting || pages.length >= maxPages}
            onClick={() => cameraInputRef.current?.click()}
            className="h-8 gap-1.5 rounded-xl border border-brand/40 bg-brand-subtle/30 text-xs font-semibold text-brand hover:bg-brand-subtle/50"
          >
            <Camera className="size-3.5 text-brand" />
            <span>{t("camera")}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isExtracting || pages.length >= maxPages}
            onClick={() => fileInputRef.current?.click()}
            className="h-8 gap-1.5 rounded-xl border-border-strong bg-surface/80 text-xs font-medium text-fg hover:bg-surface-hover"
          >
            <UploadCloud className="size-3.5 text-fg-muted" />
            <span>{t("fromFile")}</span>
          </Button>
        </div>
      </div>

      {/* Drag & Drop Canvas */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!isExtracting && pages.length < maxPages) {
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isExtracting && pages.length < maxPages) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-all",
          isDragging
            ? "border-brand bg-brand-subtle/20 shadow-inner"
            : "border-border bg-bg/60 hover:border-brand/50 hover:bg-surface/60",
          pages.length >= maxPages && "cursor-not-allowed opacity-60",
        )}
      >
        <div className="flex flex-col items-center justify-center gap-1.5">
          <FileImage className="size-6 text-brand/70" />
          <p className="text-xs font-medium text-fg-muted">{t("dropHint")}</p>
          <p className="text-[11px] text-fg-subtle">
            {t.rich("pagesCount", { count: pages.length, max: maxPages, b: (chunks) => <strong className="text-brand">{chunks}</strong> })}
          </p>
        </div>
      </div>

      {/* Thumbnails Grid */}
      {pages.length > 0 && (
        <div className="mt-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {pages.map((page, idx) => (
              <div
                key={page.id}
                className="group relative overflow-hidden rounded-xl border border-border bg-surface/80 shadow-md transition-all hover:border-brand/50"
              >
                <div
                  className="relative aspect-4/3 w-full cursor-pointer bg-black/60"
                  onClick={() => setZoomPage({ url: page.previewUrl, title: t("pageTitle", { n: idx + 1, name: page.name }) })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.previewUrl}
                    alt={t("pageN", { n: idx + 1 })}
                    className="size-full object-cover transition-transform group-hover:scale-105"
                  />
                  <span className="absolute top-1.5 left-1.5 rounded-md bg-bg/90 px-1.5 py-0.5 text-[10px] font-bold text-brand border border-border">
                    {t("pageN", { n: idx + 1 })}
                  </span>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface/90 px-2 py-1 text-[10px] font-semibold text-fg">
                      <Maximize2 className="size-3 text-brand" />
                      {t("enlarge")}
                    </span>
                  </div>
                  <button
                    type="button"
                    title={t("remove")}
                    disabled={isExtracting}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePage(idx);
                    }}
                    className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-danger/90 text-white shadow hover:bg-danger disabled:opacity-50"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-1 p-2 bg-bg/80 border-t border-border/80">
                  <span className="truncate text-[10px] font-medium text-fg-muted" title={page.name}>
                    {t("pageN", { n: idx + 1 })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={(e) => {
                        e.stopPropagation();
                        setReplacingIndex(idx);
                        replaceInputRef.current?.click();
                      }}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-fg-muted hover:bg-surface-hover hover:text-brand disabled:opacity-50"
                      title={t("replace")}
                    >
                      <RefreshCw className="size-2.5 text-brand" />
                      <span>{t("replace")}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemovePage(idx);
                      }}
                      className="inline-flex items-center rounded p-1 text-fg-subtle hover:bg-danger-bg/40 hover:text-danger disabled:opacity-50"
                      title={t("remove")}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Extracting Progress Banner */}
          {isExtracting && (
            <div className="rounded-xl border border-brand/30 bg-brand-subtle/30 p-3.5 backdrop-blur-md">
              <div className="flex items-center gap-2.5 text-xs font-semibold text-brand">
                <Loader2 className="size-4 animate-spin text-brand" />
                <span>{t("reading")}</span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                <div className="h-2 w-5/6 animate-pulse rounded bg-brand/20" />
                <div className="h-2 w-3/4 animate-pulse rounded bg-brand/20" />
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-border/80">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isExtracting}
                onClick={() => handleExtractOcr("replace")}
                className="h-9 gap-2 rounded-xl bg-brand px-4 text-xs font-semibold text-brand-fg shadow-lg hover:bg-brand-hover"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>{t("readingShort")}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    <span>{t("extract")}</span>
                  </>
                )}
              </Button>

              {currentText.trim().length > 0 && !isExtracting && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleExtractOcr("append")}
                  className="h-9 rounded-xl border-border-strong bg-surface/80 text-xs font-medium text-fg-muted hover:bg-surface-hover"
                >
                  {t("append")}
                </Button>
              )}
            </div>

            {lastExtractedCount !== null && !isExtracting && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand-subtle/40 px-2.5 py-1 text-[11px] font-semibold text-brand">
                <CheckCircle2 className="size-3.5" />
                {t("extractedCount", { count: lastExtractedCount })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Lightbox Zoom Modal */}
      {zoomPage && (
        <ImageZoomModal
          url={zoomPage.url}
          title={zoomPage.title}
          onClose={() => setZoomPage(null)}
        />
      )}
    </div>
  );
}
