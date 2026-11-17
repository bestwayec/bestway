"use client";

import * as React from "react";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Gamepad2,
  Lock,
  Play,
  PlaySquare,
  Plus,
  ShoppingCart,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TiltCard } from "@/components/ui/tilt-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { VideoCreateDialog } from "@/components/videos/video-create-dialog";
import { GamifiedVideoPlayer } from "@/components/videos/GamifiedVideoPlayer";
import { CourseCardThumbnail } from "@/components/videos/course-card-thumbnail";
import { LessonQuizModal } from "@/components/videos/LessonQuizModal";
import { motion } from "motion/react";
import {
  useVideos,
  useStreamUrl,
  usePurchaseVideo,
  useVideoPurchases,
  useConfirmPurchase,
  useDeleteVideo,
} from "@/hooks/use-videos";
import { useMe } from "@/hooks/use-me";
import type { VideoLessonItem } from "@/lib/types";
import { formatMoney, formatPhone, isSafeHref } from "@/lib/utils";


function VideoCardImage({ src, title }: { src?: string | null; title: string }) {
  const [error, setError] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  // If no src or error occurred, directly render high-fidelity CourseCardThumbnail
  if (!src || error) {
    return <CourseCardThumbnail title={title} />;
  }

  return (
    <div className="relative size-full overflow-hidden">
      {/* Underlying SVG-gradient backdrop ensures zero black box during load */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${loaded ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
        <CourseCardThumbnail title={title} />
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={title}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`size-full object-cover transition-all duration-500 group-hover:scale-105 ${
          loaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      />
    </div>
  );
}

export function VideosView() {
  const t = useTranslations("videos");
  const tc = useTranslations("common");
  const router = useRouter();
  const { data: me } = useMe();
  const role = me?.user.role;
  const isOffice = role === "admin" || role === "super_admin";
  const isStudent = role === "student";

  const [tab, setTab] = React.useState<"videos" | "purchases">("videos");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [playing, setPlaying] = React.useState<{
    url: string;
    hlsUrl?: string;
    title: string;
    lessonId: string;
    duration?: number;
    xpReward?: number;
    tiedDeckId?: string;
    tiedDeckTitle?: string;
  } | null>(null);
  const [quizLesson, setQuizLesson] = React.useState<VideoLessonItem | null>(null);
  const [quizModalOpen, setQuizModalOpen] = React.useState(false);

  const videosQ = useVideos();
  const stream = useStreamUrl();
  const purchase = usePurchaseVideo();
  const del = useDeleteVideo();

  function onWatch(v: VideoLessonItem) {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "https://api.bestwayec.uz";
    const directUrl = (v as any).streamUrl || `${apiBase}/v1/lessons/${v.id}/stream`;
    // Only use HLS when the server reports a validated stream; otherwise play the verified MP4 directly.
    const hlsUrl: string | undefined = (v as any).hlsPlaylistUrl || undefined;

    stream.mutate(v.id, {
      onSuccess: (res) => {
        const streamUrl = isSafeHref(res?.url) ? res.url : directUrl;
        setPlaying({
          url: streamUrl,
          hlsUrl,
          title: v.title,
          lessonId: (res as any)?.lessonId || v.id,
          duration: (v as any).durationSeconds || 0,
          xpReward: (v as any).xpReward || 50,
          tiedDeckId: (v as any).bamboozleDeckId,
          tiedDeckTitle: `${v.title} Quiz`,
        });
      },
      onError: () => {
        // Fallback to direct LMS stream URL
        setPlaying({
          url: directUrl,
          hlsUrl,
          title: v.title,
          lessonId: v.id,
          duration: (v as any).durationSeconds || 0,
          xpReward: (v as any).xpReward || 50,
          tiedDeckId: (v as any).bamboozleDeckId,
          tiedDeckTitle: `${v.title} Quiz`,
        });
      },
    });
  }

  function onBuy(id: string) {
    purchase.mutate(id, {
      onSuccess: () => toast.success(t("requestSent")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  function onDelete(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    del.mutate(id, {
      onSuccess: () => toast.success(t("deleted")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("title")}
        actions={
          isOffice ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-brand hover:bg-brand-hover text-brand-fg font-bold">
              <Plus className="w-4 h-4 mr-1" />
              {t("create")}
            </Button>
          ) : undefined
        }
      />

      {/* Featured Curriculum Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-r from-brand-subtle/40 via-surface to-bg-subtle p-6 shadow-xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand border border-brand/20">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gamified Video LMS &amp; Bamboozle Arena</span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-fg">
              English Grammar Foundation: Nouns to Articles
            </h2>
            <p className="text-xs md:text-sm text-fg-muted max-w-2xl">
              Ingliz tili grammatikasining asosiy darslari: yuqori sifatli video tahlil, anti-cheat pleyer va har bir dars yakunida jamoaviy Bamboozle bellashuvi.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/bamboozle")}
            className="border-brand/40 text-brand hover:bg-brand-hover/10 shrink-0 font-bold"
          >
            <Gamepad2 className="w-4 h-4 mr-2" />
            <span>Bamboozle Maydoniga O&apos;tish</span>
          </Button>
        </div>
      </div>

      {isOffice && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "videos" | "purchases")} className="mb-4">
          <TabsList>
            <TabsTrigger panel={false} value="videos">{t("title")}</TabsTrigger>
            <TabsTrigger panel={false} value="purchases">{t("purchases")}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {tab === "purchases" && isOffice ? (
        <PurchasesPanel />
      ) : videosQ.isError ? (
        <ErrorState title={tc("error")} action={<Button variant="outline" size="sm" onClick={() => videosQ.refetch()}>{tc("retry")}</Button>} />
      ) : videosQ.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
        </div>
      ) : (videosQ.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Video} title={t("noVideos")} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {videosQ.data!.map((v, idx) => {
            const duration = (v as any).durationFormatted || "15:00";
            const xpReward = (v as any).xpReward || 50;
            const isCompleted = Boolean((v as any).isCompleted);
            const isUnlocked = Boolean((v as any).isUnlocked ?? (idx === 0 || isCompleted || isOffice));
            const tiedDeckId = (v as any).bamboozleDeckId;

            return (
              <motion.div
                key={v.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: idx * 0.05 }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                className="h-full"
              >
                <TiltCard maxTilt={4} className="h-full rounded-2xl">
                  <Card className="lift group flex h-full flex-col overflow-hidden rounded-2xl border-border/80 bg-bg-subtle p-0 hover:border-brand/50 hover:shadow-e2 transition-all duration-300">
                    {/* Muqova / Artwork Banner */}
                    <div className="relative aspect-video overflow-hidden bg-surface border-b border-border/80">
                      <VideoCardImage src={v.thumbnailUrl} title={v.title} />

                      {/* Vignette Overlay */}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 opacity-70" />

                      {/* Floating Badges Bar (Top Left & Top Right) */}
                      <div className="absolute top-2.5 inset-x-2.5 z-20 flex items-center justify-between pointer-events-none">
                        {/* Status Badge */}
                        <div>
                          {isCompleted ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand/95 text-fg px-2.5 py-0.5 text-[11px] font-black shadow-[0_2px_8px_rgba(16,185,129,0.4)] backdrop-blur">
                              <CheckCircle2 className="size-3" /> Ko&apos;rilgan
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-warning text-warning-fg px-2.5 py-0.5 text-xs font-bold">
                              <Sparkles className="size-3" /> Yangi
                            </span>
                          )}
                        </div>

                        {/* Price Badge */}
                        <div>
                          {v.price === 0 ? (
                            <span className="inline-flex items-center rounded-full bg-bg/80 border border-brand/50 px-2.5 py-0.5 text-[11px] font-bold text-brand shadow backdrop-blur">
                              {t("free")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-bg/85 border border-border-strong px-2.5 py-0.5 text-[11px] font-semibold text-fg tabular-nums shadow backdrop-blur">
                              {formatMoney(v.price)} {tc("sum")}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Play Hover Overlay Button */}
                      {v.access === "granted" && (
                        <button
                          type="button"
                          onClick={() => onWatch(v)}
                          aria-label={t("watch")}
                          className="absolute inset-0 z-30 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100 focus-visible:opacity-100 bg-black/40 backdrop-blur-[2px]"
                        >
                          <span className="grid size-14 place-items-center rounded-full bg-brand text-brand-fg transition-transform duration-300 group-hover:scale-110">
                            <Play className="size-6 fill-current ml-0.5" />
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Matn va Tafsilotlar Qismi */}
                    {/* U6: fixed text heights + bottom-pinned, non-wrapping action row keep every
                        card in a row the same height with Watch/Test and the XP badge aligned. */}
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div>
                        {/* Meta qatori: Davomiylik & XP */}
                        <div className="flex items-center justify-between text-xs text-fg-muted mb-1.5">
                          <span className="inline-flex items-center gap-1 font-mono text-fg-muted">
                            <Clock className="w-3.5 h-3.5 text-brand" />
                            {duration}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-bold text-brand border border-brand/20 shadow-sm">
                            <Sparkles className="w-3 h-3" />
                            +{xpReward} XP
                          </span>
                        </div>

                        {/* Dars sarlavhasi */}
                        <h3 className="line-clamp-2 min-h-[2.5rem] sm:min-h-[2.75rem] font-black text-fg text-sm sm:text-base leading-snug group-hover:text-brand transition-colors">
                          {v.title}
                        </h3>

                        {/* Tavsif */}
                        <p className="line-clamp-2 min-h-[2.5rem] text-xs text-fg-muted mt-1 leading-relaxed">
                          {v.description ?? ""}
                        </p>
                      </div>

                      {/* Harakat tugmalari */}
                      <div className="mt-auto flex flex-nowrap items-center gap-1.5 sm:gap-2">
                        {v.access === "granted" ? (
                          <>
                            {/* 1. Watch Action */}
                            <Button
                              size="sm"
                              className="flex-1 min-w-[75px] h-9 text-xs sm:text-sm bg-brand hover:bg-brand-hover text-brand-fg font-bold shadow-md"
                              loading={stream.isPending}
                              onClick={() => onWatch(v)}
                            >
                              <PlaySquare className="w-4 h-4 mr-1 sm:mr-1.5 flex-shrink-0" />
                              <span>{t("watch")}</span>
                            </Button>

                            {/* 2. Solo Test Action */}
                            {(tiedDeckId || (v as any).hasQuiz) && (
                              isUnlocked ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setQuizLesson(v);
                                    setQuizModalOpen(true);
                                  }}
                                  className="h-9 px-2.5 sm:px-3 border-brand/40 text-brand hover:bg-brand-hover/10 text-xs font-bold shadow-sm flex-shrink-0"
                                >
                                  <FileText className="w-3.5 h-3.5 mr-1 text-brand flex-shrink-0" />
                                  <span>Test</span>
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled
                                  title="Avval videoni ko'ring"
                                  className="h-9 px-2.5 sm:px-3 opacity-40 cursor-not-allowed border-border text-fg-subtle text-xs font-bold flex-shrink-0"
                                >
                                  <Lock className="w-3.5 h-3.5 mr-1 text-fg-subtle flex-shrink-0" />
                                  <span>Test</span>
                                </Button>
                              )
                            )}

                            {/* 3. Bamboozle Team Battle Arena Action */}
                            {tiedDeckId && (
                              isUnlocked ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => router.push(`/bamboozle?deck=${tiedDeckId}`)}
                                  className="h-9 px-2 sm:px-2.5 border-warning/40 text-warning hover:bg-warning/10 text-xs font-bold shadow-sm flex-shrink-0"
                                >
                                  <Gamepad2 className="w-3.5 h-3.5 mr-1 text-warning flex-shrink-0" />
                                  <span>Arena</span>
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled
                                  title="Avval videoni ko'ring"
                                  className="h-9 px-2 sm:px-2.5 opacity-40 cursor-not-allowed border-border text-fg-subtle text-xs font-bold flex-shrink-0"
                                >
                                  <Lock className="w-3.5 h-3.5 mr-1 text-fg-subtle flex-shrink-0" />
                                  <span>Arena</span>
                                </Button>
                              )
                            )}
                          </>
                        ) : v.access === "pending_confirmation" ? (
                          <Badge variant="warning" className="flex-1 justify-center py-1.5">
                            <Clock className="w-3 h-3 mr-1" /> {t("pending")}
                          </Badge>
                        ) : isStudent ? (
                          <Button size="sm" variant="outline" className="flex-1" loading={purchase.isPending} onClick={() => onBuy(v.id)}>
                            <ShoppingCart className="w-3.5 h-3.5 mr-1" />
                            {t("buy")}
                          </Button>
                        ) : (
                          <Badge variant="neutral" className="flex-1 justify-center py-1.5">
                            <Lock className="w-3 h-3 mr-1" /> {t("locked")}
                          </Badge>
                        )}

                        {isOffice && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onDelete(v.id)}
                            aria-label={t("delete")}
                            className="text-fg-subtle hover:text-danger p-2"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                </TiltCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Gamified Anti-Cheat Video Player Modal */}
      <Dialog open={Boolean(playing)} onOpenChange={(open) => !open && setPlaying(null)}>
        <DialogContent className="w-[96vw] max-w-4xl max-h-[92dvh] overflow-hidden p-0 bg-bg-subtle border border-brand/30 shadow-2xl rounded-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{playing?.title ?? t("watch")}</DialogTitle>
          </DialogHeader>
          {playing && (
            <GamifiedVideoPlayer
              src={playing.url}
              hlsSrc={playing.hlsUrl}
              lessonId={playing.lessonId}
              lessonTitle={playing.title}
              lessonDuration={playing.duration || 0}
              xpReward={playing.xpReward || 50}
              tiedDeckId={playing.tiedDeckId}
              tiedDeckTitle={playing.tiedDeckTitle}
              onStartBamboozle={(deckId) => {
                setPlaying(null);
                router.push(`/bamboozle?deck=${deckId}`);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Admin Video Create Dialog */}
      {isOffice && (
        <VideoCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
      {/* Solo Grammar Quiz Runner Modal */}
      {quizLesson && (
        <LessonQuizModal
          isOpen={quizModalOpen}
          onClose={() => setQuizModalOpen(false)}
          lessonId={quizLesson.id}
          lessonTitle={quizLesson.title}
          onQuizCompleted={(_earnedXp) => {
            videosQ.refetch();
          }}
        />
      )}
    </div>
  );
}

function PurchasesPanel() {
  const t = useTranslations("videos");
  const tc = useTranslations("common");
  const [filter, setFilter] = React.useState<"all" | "pending_confirmation" | "purchased">("pending_confirmation");
  const q = useVideoPurchases(filter === "all" ? undefined : filter);
  const confirmP = useConfirmPurchase();

  function onConfirm(videoId: string, userId: string) {
    confirmP.mutate({ videoId, userId }, {
      onSuccess: () => toast.success(t("confirmed")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["pending_confirmation", "purchased", "all"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? "primary" : "outline"}
            onClick={() => setFilter(s)}
          >
            {t(`filter_${s}` as any)}
          </Button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : q.isError ? (
        <ErrorState title={tc("error")} />
      ) : (q.data?.length ?? 0) === 0 ? (
        <EmptyState title={t("noPurchases")} />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {q.data!.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-semibold text-fg">{p.videoTitle}</p>
                <p className="text-sm text-fg-muted">
                  {p.userName} &bull; {formatPhone(p.userPhone)}
                </p>
              </div>
              <div>
                {p.status === "pending_confirmation" ? (
                  <Button
                    size="sm"
                    loading={confirmP.isPending}
                    onClick={() => onConfirm(p.videoId, p.userId)}
                  >
                    {t("confirm")}
                  </Button>
                ) : (
                  <Badge variant="success">{t("purchased")}</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
