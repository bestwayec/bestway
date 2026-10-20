"use client";

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
        className="flex w-full max-w-4xl items-center justify-between gap-3 border-b border-slate-800 bg-[#0B0F17]/90 px-4 py-2.5 text-white rounded-t-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-semibold truncate text-slate-200">
          {title || "Qo'lyozma rasm (Kattalashtirilgan ko'rinish)"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="size-8 p-0 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
            onClick={() => setZoomLevel((z) => Math.min(z + 0.3, 3))}
            title="Kattalashtirish"
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="size-8 p-0 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
            onClick={() => setZoomLevel((z) => Math.max(z - 0.3, 0.6))}
            title="Kichiklashtirish"
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2.5 border-slate-700 bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700"
            onClick={() => setZoomLevel(1)}
          >
            {Math.round(zoomLevel * 100)}%
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="size-8 p-0 border-rose-800/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60"
            onClick={onClose}
            title="Yopish (Esc)"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Image Preview Canvas */}
      <div
        className="relative flex size-full max-w-4xl flex-1 items-center justify-center overflow-auto rounded-b-xl border border-slate-800 bg-[#05080F] p-4 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={title || "Qo'lyozma sahifa"}
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
  const [pages, setPages] = useState<WritingPageItem[]>(() =>
    (initialImageUrls ?? []).slice(0, maxPages).map((url, idx) => ({
      id: `init-${idx}-${url}`,
      previewUrl: url,
      name: `${idx + 1}-bet`,
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
      return `${file.name}: format qo'llab-quvvatlanmaydi. Faqat JPG, PNG yoki WEBP formatidagi rasmlar ruxsat etiladi.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `${file.name}: fayl hajmi 10 MB dan oshmasligi kerak.`;
    }
    return null;
  }, []);

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      if (incoming.length === 0) return;

      const remainingSlots = maxPages - pages.length;
      if (remainingSlots <= 0) {
        toast.warning(`Ko'pi bilan ${maxPages} ta sahifa yuklash mumkin.`);
        return;
      }

      const filesToAdd = incoming.slice(0, remainingSlots);
      if (incoming.length > remainingSlots) {
        toast.info(
          `Faqat dastlabki ${remainingSlots} ta sahifa qo'shildi (chegara: ${maxPages} ta).`,
        );
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
        toast.success(
          `${validNewPages.length} ta qo'lyozma sahifasi yuklandi. AI matnni o'qishi uchun quyidagi tugmani bosing.`,
        );
      }
    },
    [maxPages, pages.length, validateFile],
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
      toast.success(`${index + 1}-bet yangi rasmga almashtirildi.`);
    },
    [validateFile],
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
      toast.error("Avval kamida bitta qo'lyozma varag'i rasmini yuklang.");
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
        toast.warning("Rasmdan matn aniqlanmadi. Iltimos, yorug'roq va aniqroq rasm yuklang.");
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

      const words = extracted.split(/\s+/).filter(Boolean).length;
      setLastExtractedCount(words);
      onExtractedText(extracted, mode);
      toast.success(`Qo'lyozma o'qildi (${words} ta so'z). Matn muharririga ko'chirildi.`);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "OCR matnni ajratib olishda xatolik yuz berdi. Qayta urinib ko'ring.";
      toast.error(msg);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-800/80 bg-[#0B0F17]/90 p-4 shadow-xl backdrop-blur-xl transition-all",
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
          <span className="inline-flex size-8 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-emerald-400 shadow-sm">
            <ScanText className="size-4" />
          </span>
          <div>
            <p className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
              <span>Qo&apos;lyozma Inshoni Yuklash & AI Vision OCR</span>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                DeepSeek Vision
              </span>
            </p>
            <p className="text-[11px] text-slate-400">
              Daftarga yozilgan varaqni telefon kamerasi yoki fayl orqali yuklang (JPG, PNG, max 10MB)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={isExtracting || pages.length >= maxPages}
            onClick={() => cameraInputRef.current?.click()}
            className="h-8 gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/50"
          >
            <Camera className="size-3.5 text-emerald-400" />
            <span>📷 Kamera / Rasm olish</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isExtracting || pages.length >= maxPages}
            onClick={() => fileInputRef.current?.click()}
            className="h-8 gap-1.5 rounded-xl border-slate-700 bg-slate-900/80 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <UploadCloud className="size-3.5 text-slate-400" />
            <span>Fayldan tanlash</span>
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
            ? "border-emerald-500 bg-emerald-950/20 shadow-inner"
            : "border-slate-800 bg-slate-950/60 hover:border-emerald-500/50 hover:bg-slate-900/60",
          pages.length >= maxPages && "cursor-not-allowed opacity-60",
        )}
      >
        <div className="flex flex-col items-center justify-center gap-1.5">
          <FileImage className="size-6 text-emerald-400/70" />
          <p className="text-xs font-medium text-slate-300">
            Daftar varag&apos;i rasmlarini bu yerga tashlang yoki bosib yuklang
          </p>
          <p className="text-[11px] text-slate-500">
            Sahifalar: <strong className="text-emerald-400">{pages.length}</strong> / {maxPages} ta
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
                className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 shadow-md transition-all hover:border-emerald-500/50"
              >
                <div
                  className="relative aspect-4/3 w-full cursor-pointer bg-black/60"
                  onClick={() => setZoomPage({ url: page.previewUrl, title: `${idx + 1}-bet: ${page.name}` })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.previewUrl}
                    alt={`${idx + 1}-bet`}
                    className="size-full object-cover transition-transform group-hover:scale-105"
                  />
                  <span className="absolute top-1.5 left-1.5 rounded-md bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-slate-800">
                    {idx + 1}-bet
                  </span>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-900/90 px-2 py-1 text-[10px] font-semibold text-white">
                      <Maximize2 className="size-3 text-emerald-400" />
                      Kattalashtirish
                    </span>
                  </div>
                  <button
                    type="button"
                    title="O'chirish"
                    disabled={isExtracting}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePage(idx);
                    }}
                    className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-rose-600/90 text-white shadow hover:bg-rose-700 disabled:opacity-50"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-1 p-2 bg-slate-950/80 border-t border-slate-800/80">
                  <span className="truncate text-[10px] font-medium text-slate-400" title={page.name}>
                    {idx + 1}-bet
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
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-800 hover:text-emerald-300 disabled:opacity-50"
                      title="Almashtirish"
                    >
                      <RefreshCw className="size-2.5 text-emerald-400" />
                      <span>Almashtirish</span>
                    </button>
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemovePage(idx);
                      }}
                      className="inline-flex items-center rounded p-1 text-slate-500 hover:bg-rose-950/40 hover:text-rose-400 disabled:opacity-50"
                      title="O'chirish"
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
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3.5 backdrop-blur-md">
              <div className="flex items-center gap-2.5 text-xs font-semibold text-emerald-300">
                <Loader2 className="size-4 animate-spin text-emerald-400" />
                <span>AI Vision qo&apos;lyozmani matnga aylantirmoqda...</span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                <div className="h-2 w-5/6 animate-pulse rounded bg-emerald-500/20" />
                <div className="h-2 w-3/4 animate-pulse rounded bg-emerald-500/20" />
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isExtracting}
                onClick={() => handleExtractOcr("replace")}
                className="h-9 gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Qo&apos;lyozma o&apos;qilmoqda...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    <span>🔍 Matnni ajratib olish (OCR & AI)</span>
                  </>
                )}
              </Button>

              {currentText.trim().length > 0 && !isExtracting && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleExtractOcr("append")}
                  className="h-9 rounded-xl border-slate-700 bg-slate-900/80 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Davomiga qo&apos;shish
                </Button>
              )}
            </div>

            {lastExtractedCount !== null && !isExtracting && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                OCR: {lastExtractedCount} ta so&apos;z ajratib olindi
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
