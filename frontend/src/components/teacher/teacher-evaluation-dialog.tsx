"use client";

import * as React from "react";
import {
  Award,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileCheck,
  FileText,
  Headphones,
  Maximize2,
  PenTool,
  RotateCw,
  Sparkles,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAttemptAssessments, useTeacherGradeAttempt } from "@/hooks/use-assessment";
import { useMockAttempt } from "@/hooks/use-mock";
import { cn } from "@/lib/utils";

interface TeacherEvaluationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attemptId: string | null;
  studentName?: string;
  initialWritingScore?: number | null;
  initialSpeakingScore?: number | null;
  initialFinalScore?: number | null;
  onGraded?: () => void;
}

export function TeacherEvaluationDialog({
  open,
  onOpenChange,
  attemptId,
  studentName = "O'quvchi",
  initialWritingScore,
  initialSpeakingScore,
  initialFinalScore,
  onGraded,
}: TeacherEvaluationDialogProps) {
  // Query attempt details and AI assessments
  const attemptQ = useMockAttempt(attemptId ?? "");
  const assessmentQ = useAttemptAssessments(attemptId ?? "", open && !!attemptId);
  const gradeMutation = useTeacherGradeAttempt(attemptId ?? "");

  // Form State
  const [writingScore, setWritingScore] = React.useState<string>("");
  const [speakingScore, setSpeakingScore] = React.useState<string>("");
  const [finalScore, setFinalScore] = React.useState<string>("");
  const [teacherComment, setTeacherComment] = React.useState<string>("");

  // Lightbox Zoom state for handwriting images
  const [lightboxImg, setLightboxImg] = React.useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = React.useState<number>(1);
  const [rotation, setRotation] = React.useState<number>(0);

  // Active section tab
  const [activeTab, setActiveTab] = React.useState<"writing" | "speaking">("writing");

  // Sync initial scores when attempt or assessment loads
  React.useEffect(() => {
    if (!open) return;
    const att = attemptQ.data;
    const ass = assessmentQ.data;

    const wScore =
      att?.sectionBands?.writing ??
      att?.standardScores?.writing ??
      initialWritingScore ??
      "";
    const sScore =
      att?.sectionBands?.speaking ??
      att?.standardScores?.speaking ??
      initialSpeakingScore ??
      "";
    const fScore =
      att?.overallBand ??
      att?.overallScore ??
      initialFinalScore ??
      "";

    setWritingScore(wScore !== "" && wScore !== null ? String(wScore) : "");
    setSpeakingScore(sScore !== "" && sScore !== null ? String(sScore) : "");
    setFinalScore(fScore !== "" && fScore !== null ? String(fScore) : "");

    const existingComment =
      ass?.teacher_comment ||
      ass?.teacherComment ||
      (att?.mediaState as Record<string, unknown>)?.teacher_comment ||
      "";
    setTeacherComment(String(existingComment || ""));
  }, [open, attemptQ.data, assessmentQ.data, initialWritingScore, initialSpeakingScore, initialFinalScore]);

  // Compute calculated overall when writing & speaking change
  const handleRecalculateOverall = () => {
    const w = parseFloat(writingScore);
    const s = parseFloat(speakingScore);
    if (!isNaN(w) && !isNaN(s)) {
      const avg = Math.round(((w + s) / 2) * 2) / 2;
      setFinalScore(String(avg));
    } else if (!isNaN(w)) {
      setFinalScore(String(w));
    } else if (!isNaN(s)) {
      setFinalScore(String(s));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attemptId) return;

    const fVal = finalScore !== "" ? parseFloat(finalScore) : undefined;
    const wVal = writingScore !== "" ? parseFloat(writingScore) : undefined;
    const sVal = speakingScore !== "" ? parseFloat(speakingScore) : undefined;

    if (fVal === undefined && wVal === undefined && sVal === undefined) {
      toast.error("Iltimos, kamida bitta bahoni kiriting!");
      return;
    }

    try {
      await gradeMutation.mutateAsync({
        final_score: fVal,
        writing_score: wVal,
        speaking_score: sVal,
        teacher_comment: teacherComment.trim(),
      });
      toast.success("Ustozning rasmiy bahosi muvaffaqiyatli saqlandi!");
      onGraded?.();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Baholashni saqlashda xatolik yuz berdi";
      toast.error(msg);
    }
  };

  const attempt = attemptQ.data;
  const assessmentData = assessmentQ.data;

  // Extract candidate answers
  const sections = attempt?.sections || [];
  const writingSection = sections.find((s) => s.skill === "writing");
  const speakingSection = sections.find((s) => s.skill === "speaking");

  const writingQuestions = writingSection?.groups?.flatMap((g) => g.questions) || [];
  const speakingQuestions = speakingSection?.groups?.flatMap((g) => g.questions) || [];

  // Extract handwriting images if present
  const mediaState = (attempt?.mediaState || {}) as Record<string, unknown>;
  const handwritingImages: string[] = Array.isArray(mediaState.writing_images)
    ? (mediaState.writing_images as string[])
    : [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col p-0 border border-emerald-500/20 bg-[#0B0F17] text-slate-100 shadow-2xl">
          {/* Header */}
          <DialogHeader className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 flex flex-row items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <Award className="size-5 text-emerald-400" />
                  Dual-Layer Baholash va Ustoz Tasdiqi
                </DialogTitle>
                <Badge variant="neutral" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs">
                  {studentName}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-slate-400 mt-1">
                Sun&apos;iy intellekt tahlili va o&apos;quvchining haqiqiy topshiriqlarini tekshirib, yakuniy rasmiy ballni belgilang.
              </DialogDescription>
            </div>
            {attempt?.status && (
              <Badge className="bg-slate-800 text-slate-300 border border-slate-700 text-xs">
                Holati: {attempt.status === "completed" ? "Yakunlangan" : "Jarayonda"}
              </Badge>
            )}
          </DialogHeader>

          {/* Section Selector Pills */}
          <div className="px-6 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("writing")}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all",
                  activeTab === "writing"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                )}
              >
                <PenTool className="size-3.5" />
                Writing ({writingQuestions.length} ta topshiriq)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("speaking")}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all",
                  activeTab === "speaking"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                )}
              >
                <Headphones className="size-3.5" />
                Speaking ({speakingQuestions.length} ta savol)
              </button>
            </div>

            {/* Quick score summary indicators */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-400">
                AI Balli: <strong className="text-emerald-400">{assessmentData?.overall_band ?? attempt?.overallBand ?? "-"}</strong>
              </span>
              <span className="text-slate-400">
                Ustoz Balli: <strong className="text-amber-400">{finalScore || "-"}</strong>
              </span>
            </div>
          </div>

          {/* Main Dual-Column Workspace */}
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#0B0F17]">
            {/* LEFT COLUMN: Candidate Work */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <FileText className="size-4 text-emerald-400" />
                  O&apos;quvchining Haqiqiy Javoblari
                </h3>
                <span className="text-xs text-slate-400">
                  {activeTab === "writing" ? "Insho & Qo'lyozma" : "Audio Yozuvlar"}
                </span>
              </div>

              {activeTab === "writing" && (
                <div className="space-y-4">
                  {/* Handwriting Photos Gallery if available */}
                  {handwritingImages.length > 0 && (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                          <Eye className="size-3.5 text-emerald-400" />
                          Yuklangan Qo&apos;lyozma Rasmlari ({handwritingImages.length} ta)
                        </span>
                        <span className="text-[11px] text-slate-400">Kattalashtirish uchun bosing</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {handwritingImages.map((imgUrl, i) => (
                          <div
                            key={i}
                            onClick={() => {
                              setLightboxImg(imgUrl);
                              setZoomLevel(1);
                              setRotation(0);
                            }}
                            className="group relative aspect-[3/4] rounded-lg overflow-hidden border border-slate-700 bg-slate-950 cursor-pointer hover:border-emerald-500 transition-all"
                          >
                            <img src={imgUrl} alt={`Handwriting ${i + 1}`} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Maximize2 className="size-4 text-white" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Essay Questions and Text Responses */}
                  {writingQuestions.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 rounded-xl border border-dashed border-slate-800">
                      Ushbu imtihonda Writing javoblari topilmadi
                    </div>
                  ) : (
                    writingQuestions.map((q, idx) => (
                      <div key={q.id || idx} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald-400">Task {idx + 1} Javobi</span>
                          {q.response && (
                            <span className="text-[11px] text-slate-400">
                              {q.response.trim().split(/\s+/).filter(Boolean).length} so&apos;z
                            </span>
                          )}
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-xs text-slate-200 leading-relaxed font-mono whitespace-pre-wrap max-h-56 overflow-y-auto">
                          {q.response ? q.response : <span className="text-slate-500 italic">Matn kiritilmagan</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "speaking" && (
                <div className="space-y-3">
                  {speakingQuestions.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 rounded-xl border border-dashed border-slate-800">
                      Ushbu imtihonda Speaking audio javoblari topilmadi
                    </div>
                  ) : (
                    speakingQuestions.map((q, idx) => (
                      <div key={q.id || idx} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                            <Volume2 className="size-3.5" />
                            Savol {idx + 1} Audio Yozuvi
                          </span>
                          {q.score !== null && (
                            <Badge variant="neutral" className="text-[10px] border-emerald-500/30 text-emerald-300">
                              Baho: {q.score}
                            </Badge>
                          )}
                        </div>

                        {q.audioUrl ? (
                          <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                            <audio controls src={q.audioUrl} className="w-full h-8" />
                          </div>
                        ) : (
                          <div className="p-2 rounded bg-slate-950 text-center text-xs text-slate-500">
                            Audio yozuv mavjud emas
                          </div>
                        )}

                        {q.response && (
                          <div className="text-[11px] text-slate-300 bg-slate-950/60 p-2.5 rounded border border-slate-800 space-y-1.5">
                            <div>
                              <strong className="text-slate-400 block mb-0.5">Nutq Transkripsiyasi (STT):</strong>
                              {q.response}
                            </div>
                            {(() => {
                              const diag = (mediaState.speech_diagnostics as Record<string, any>)?.[q.id];
                              if (!diag) return null;
                              return (
                                <div className="mt-2 pt-2 border-t border-slate-800 text-[10px] space-y-1">
                                  <div className="flex items-center justify-between text-emerald-400 font-semibold">
                                    <span>Fonetik / Ravonlik Tahlili:</span>
                                    {diag.fluency_score && <span>Ravonlik: {diag.fluency_score}/9.0</span>}
                                  </div>
                                  {diag.mispronounced_words?.length > 0 && (
                                    <div className="text-amber-400">
                                      <span>Noaniq talaffuz: </span>
                                      {diag.mispronounced_words.map((m: any, mi: number) => (
                                        <span key={mi} className="text-slate-300">{m.word} ({m.issue}){mi < diag.mispronounced_words.length - 1 ? ", " : ""}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: AI Criteria Evaluation & Strengths */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Sparkles className="size-4 text-emerald-400" />
                  Sun&apos;iy Intellekt Mezonlari (AI Feedback)
                </h3>
                <span className="text-xs text-slate-400">DeepSeek & CEFR</span>
              </div>

              {/* Overall AI Band banner */}
              <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-950/30 to-slate-900 p-3.5 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400 block">AI Tavsiya Qilgan Umumiy Natija</span>
                  <span className="text-lg font-bold text-emerald-400">
                    {assessmentData?.overall_band ?? attempt?.overallBand ?? "Baholanmoqda"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Ishonchlilik Darajasi</span>
                  <span className="text-xs font-semibold text-slate-200">
                    {assessmentData?.confidence ? `${Math.round(assessmentData.confidence * 100)}%` : "Yuqori"}
                  </span>
                </div>
              </div>

              {/* Criteria Scores grid */}
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-slate-300">Baholash Mezonlari Bo&apos;yicha Natijalar:</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(assessmentData?.criteria_scores || {}).map(([crit, val]) => (
                    <div key={crit} className="p-2.5 rounded-lg border border-slate-800 bg-slate-900/60 flex items-center justify-between">
                      <span className="text-slate-400 capitalize">{crit.replace(/_/g, " ")}</span>
                      <strong className="text-emerald-400 font-bold">{val}</strong>
                    </div>
                  ))}
                  {Object.keys(assessmentData?.criteria_scores || {}).length === 0 && (
                    <div className="col-span-2 p-3 text-center text-xs text-slate-500 border border-slate-800 rounded-lg">
                      Standart CEFR mezonlari bo&apos;yicha tahlil shakllantirilgan
                    </div>
                  )}
                </div>
              </div>

              {/* Strengths & Weaknesses */}
              {((assessmentData?.strengths?.length ?? 0) > 0 || (assessmentData?.weaknesses?.length ?? 0) > 0) && (
                <div className="space-y-3 pt-2">
                  {assessmentData?.strengths && assessmentData.strengths.length > 0 && (
                    <div className="p-3 rounded-lg border border-emerald-900/30 bg-emerald-950/20 space-y-1">
                      <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="size-3.5" />
                        Kuchli Tomonlari:
                      </span>
                      <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5">
                        {assessmentData.strengths.map((s, idx) => (
                          <li key={idx}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {assessmentData?.weaknesses && assessmentData.weaknesses.length > 0 && (
                    <div className="p-3 rounded-lg border border-rose-900/30 bg-rose-950/20 space-y-1">
                      <span className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                        <FileCheck className="size-3.5" />
                        Yaxshilash Kerak Bo&apos;lgan Jihatlar:
                      </span>
                      <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5">
                        {assessmentData.weaknesses.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* BOTTOM FORM: Teacher Score Override */}
          <form onSubmit={handleSubmit} className="border-t border-slate-800 bg-slate-900/80 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <PenTool className="size-3.5" />
                Ustozning Yakuniy Rasmiy Bahosi (Override)
              </span>
              <button
                type="button"
                onClick={handleRecalculateOverall}
                className="text-xs text-slate-400 hover:text-emerald-400 underline transition-colors"
              >
                O&apos;rtacha umumiy ballni avto-hisoblash
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Writing Balli:</label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  max="75"
                  value={writingScore}
                  onChange={(e) => setWritingScore(e.target.value)}
                  placeholder="masalan: 6.5 yoki 65"
                  className="bg-slate-950 border-slate-700 text-slate-100 text-sm focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Speaking Balli:</label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  max="75"
                  value={speakingScore}
                  onChange={(e) => setSpeakingScore(e.target.value)}
                  placeholder="masalan: 7.0 yoki 70"
                  className="bg-slate-950 border-slate-700 text-slate-100 text-sm focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs text-emerald-400 font-semibold mb-1 block">Yakuniy Ball (Final):</label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  max="75"
                  value={finalScore}
                  onChange={(e) => setFinalScore(e.target.value)}
                  placeholder="masalan: 6.75 yoki 68"
                  className="bg-slate-950 border-emerald-500/50 text-emerald-300 font-bold text-sm focus:border-emerald-400"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Ustozning Pedagogik Tavsiyasi va Feedbacki:</label>
              <textarea
                value={teacherComment}
                onChange={(e) => setTeacherComment(e.target.value)}
                placeholder="Insho va og'zaki nutqdagi muhim tuzatishlar va tavsiyalarni yozing..."
                rows={2}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none resize-none"
              />
            </div>

            <DialogFooter className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Bekor qilish
              </Button>
              <Button
                type="submit"
                size="sm"
                loading={gradeMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1.5 shadow-lg shadow-emerald-900/30"
              >
                <CheckCircle2 className="size-4" />
                <span>Yakuniy Bahoni Tasdiqlash</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* LIGHTBOX MODAL FOR HANDWRITING ZOOM */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxImg(null)}
        >
          {/* Lightbox Controls */}
          <div
            className="absolute top-4 right-4 flex items-center gap-2 bg-slate-900/80 p-2 rounded-xl border border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="icon"
              variant="outline"
              className="size-8 text-slate-200"
              onClick={() => setZoomLevel((z) => Math.min(z + 0.3, 3))}
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8 text-slate-200"
              onClick={() => setZoomLevel((z) => Math.max(z - 0.3, 0.5))}
            >
              <ZoomOut className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8 text-slate-200"
              onClick={() => setRotation((r) => (r + 90) % 360)}
            >
              <RotateCw className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8 text-rose-400 hover:text-rose-300"
              onClick={() => setLightboxImg(null)}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div
            className="overflow-auto max-w-[90vw] max-h-[85vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxImg}
              alt="Zoomed Handwriting"
              style={{
                transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                transition: "transform 0.2s ease-out",
              }}
              className="max-h-[80vh] rounded-lg shadow-2xl object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
