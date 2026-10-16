"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  FileImage,
  Loader2,
  RefreshCw,
  ScanText,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
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
  /** Custom OCR endpoint override (defaults to `/api/v1/mock/attempts/${attemptId}/writing/${questionId}/ocr`) */
  ocrEndpoint?: string;
  className?: string;
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke object URLs on unmount
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
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
      return `"${file.name}" formati qo'llab-quvvatlanmaydi. Faqat JPG, PNG yoki WEBP yuklang.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      return `"${file.name}" hajmi ${sizeMb} MB — maksimal ruxsat etilgan hajm 10 MB.`;
    }
    return null;
  }, []);

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      if (incoming.length === 0) return;

      const validItems: WritingPageItem[] = [];
      for (const file of incoming) {
        const error = validateFile(file);
        if (error) {
          toast.error(error);
          continue;
        }
        validItems.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          name: file.name,
          sizeBytes: file.size,
        });
      }

      if (validItems.length === 0) return;

      setPages((prev) => {
        const remaining = maxPages - prev.length;
        if (remaining <= 0) {
          toast.warning(`Maksimal ${maxPages} ta sahifa yuklash mumkin.`);
          for (const item of validItems) {
            URL.revokeObjectURL(item.previewUrl);
          }
          return prev;
        }
        if (validItems.length > remaining) {
          toast.warning(`Maksimal ${maxPages} ta sahifa: faqat dastlabki ${remaining} tasi qo'shildi.`);
          for (const extra of validItems.slice(remaining)) {
            URL.revokeObjectURL(extra.previewUrl);
          }
        }
        return [...prev, ...validItems.slice(0, remaining)];
      });
    },
    [maxPages, validateFile],
  );

  const handleReplaceFile = useCallback(
    (index: number, file: File) => {
      const error = validateFile(file);
      if (error) {
        toast.error(error);
        return;
      }
      const newItem: WritingPageItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
        sizeBytes: file.size,
      };
      setPages((prev) => {
        const next = [...prev];
        const old = next[index];
        if (old?.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(old.previewUrl);
        }
        next[index] = newItem;
        return next;
      });
      toast.success(`${index + 1}-bet yangilandi`);
    },
    [validateFile],
  );

  const handleRemovePage = useCallback((index: number) => {
    setPages((prev) => {
      const target = prev[index];
      if (target?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((_, idx) => idx !== index);
    });
  }, []);

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
      toast.error("Avval kamida bitta qo'lyozma rasmini yuklang.");
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
      toast.success(`Qo'lyozma o'qildi (${words} ta so'z). Matnni tekshirib tahrirlashingiz mumkin.`);
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
        "rounded-lg border border-slate-300 bg-slate-50/90 p-3.5 shadow-2xs transition-colors",
        className,
      )}
      onDragStart={(e) => e.stopPropagation()}
    >
      {/* Hidden inputs for file picker, mobile camera, and single-page replace */}
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

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-blue-600/10 text-blue-700">
            <ScanText className="size-4" />
          </span>
          <div>
            <p className="text-xs font-bold text-slate-900">
              Qo&apos;lyozma rasmni yuklash va OCR (AI matnga aylantirish)
            </p>
            <p className="text-[11px] text-slate-600">
              JPG, PNG, WEBP (har biri max 10MB, {maxPages} betgacha) — telefon kamerasi yoki fayl orqali
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isExtracting || pages.length >= maxPages}
            onClick={() => cameraInputRef.current?.click()}
            className="h-8 gap-1.5 border-blue-300 bg-white text-xs font-semibold text-blue-700 hover:bg-blue-50"
          >
            <Camera className="size-3.5" />
            <span>📷 Rasmga olish yoki yuklash</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isExtracting || pages.length >= maxPages}
            onClick={() => fileInputRef.current?.click()}
            className="h-8 gap-1.5 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <UploadCloud className="size-3.5" />
            <span className="hidden sm:inline">Fayl tanlash</span>
          </Button>
        </div>
      </div>

      {/* Drag & Drop Dropzone */}
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
          "cursor-pointer rounded-md border-2 border-dashed px-3 py-3 text-center transition-all",
          isDragging
            ? "border-blue-600 bg-blue-50/70"
            : "border-slate-300 bg-white/80 hover:border-blue-400 hover:bg-white",
          pages.length >= maxPages && "cursor-not-allowed opacity-60",
        )}
      >
        <div className="flex flex-col items-center justify-center gap-1">
          <FileImage className="size-5 text-slate-400" />
          <p className="text-xs font-medium text-slate-700">
            Qo&apos;lyozma rasmlarini shu yerga tashlang yoki bosib tanlang
          </p>
          <p className="text-[11px] text-slate-500">
            Yuklangan sahifalar: <strong className="text-slate-700">{pages.length}</strong> / {maxPages}
          </p>
        </div>
      </div>

      {/* Page Thumbnails */}
      {pages.length > 0 && (
        <div className="mt-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
            {pages.map((page, idx) => (
              <div
                key={page.id}
                className="group relative overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xs"
              >
                <div className="relative aspect-4/3 w-full bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.previewUrl}
                    alt={`${idx + 1}-bet`}
                    className="size-full object-cover"
                  />
                  <span className="absolute top-1.5 left-1.5 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {idx + 1}-bet
                  </span>
                  <button
                    type="button"
                    title="O'chirish"
                    disabled={isExtracting}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePage(idx);
                    }}
                    className="absolute top-1.5 right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-red-600/90 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <X className="size-3" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-1 px-2 py-1.5 bg-white">
                  <span className="truncate text-[10px] font-medium text-slate-600" title={page.name}>
                    {idx + 1}-bet
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={(e) => {
                        e.stopPropagation();
                        setReplacingIndex(idx);
                        replaceInputRef.current?.click();
                      }}
                      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      title="Almashtirish"
                    >
                      <RefreshCw className="size-2.5" />
                      <span>Almashtirish</span>
                    </button>
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemovePage(idx);
                      }}
                      className="inline-flex items-center rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="O'chirish"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Loading Skeleton / Status during OCR */}
          {isExtracting && (
            <div className="rounded-md border border-blue-200 bg-blue-50/80 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-800">
                <Loader2 className="size-4 animate-spin text-blue-600" />
                <span>Qo&apos;lyozma o&apos;qilmoqda...</span>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="h-2.5 w-5/6 animate-pulse rounded bg-blue-200/70" />
                <div className="h-2.5 w-3/4 animate-pulse rounded bg-blue-200/70" />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isExtracting}
                onClick={() => handleExtractOcr("replace")}
                className="h-8 gap-1.5 bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Qo&apos;lyozma o&apos;qilmoqda...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    <span>🔍 Matnni ajratib olish (OCR)</span>
                  </>
                )}
              </Button>

              {currentText.trim().length > 0 && !isExtracting && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleExtractOcr("append")}
                  className="h-8 text-xs font-medium text-slate-700"
                >
                  Davomiga qo&apos;shish
                </Button>
              )}
            </div>

            {lastExtractedCount !== null && !isExtracting && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" />
                OCR: {lastExtractedCount} so&apos;z ajratib olindi
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
