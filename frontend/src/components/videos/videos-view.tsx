"use client";

import * as React from "react";
import {
  BookOpen,
  CheckCircle2,
  Clock,
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
    title: string;
    lessonId: string;
    duration?: number;
    xpReward?: number;
    tiedDeckId?: string;
    tiedDeckTitle?: string;
  } | null>(null);

  const videosQ = useVideos();
  const stream = useStreamUrl();
  const purchase = usePurchaseVideo();
  const del = useDeleteVideo();

  function onWatch(v: VideoLessonItem) {
    const directUrl = (v as any).streamUrl || `/api/backend/v1/lessons/${v.id}/stream`;
    stream.mutate(v.id, {
      onSuccess: (res) => {
        const streamUrl = isSafeHref(res?.url) ? res.url : directUrl;
        setPlaying({
          url: streamUrl,
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
            <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold">
              <Plus className="w-4 h-4 mr-1" />
              {t("create")}
            </Button>
          ) : undefined
        }
      />

      {/* Featured Curriculum Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-[#0B0F17] p-6 shadow-xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gamified Video LMS &amp; Bamboozle Arena</span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white">
              English Grammar Foundation: Nouns to Articles
            </h2>
            <p className="text-xs md:text-sm text-slate-400 max-w-2xl">
              Ingliz tili grammatikasining asosiy darslari: yuqori sifatli video tahlil, anti-cheat pleyer va har bir dars yakunida jamoaviy Bamboozle bellashuvi.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/bamboozle")}
            className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 shrink-0 font-bold"
          >
            <Gamepad2 className="w-4 h-4 mr-2" />
            <span>Bamboozle Maydoniga O&apos;tish</span>
          </Button>
        </div>
      </div>

      {isOffice && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "videos" | "purchases")} className="mb-4">
          <TabsList>
            <TabsTrigger value="videos">{t("title")}</TabsTrigger>
            <TabsTrigger value="purchases">{t("purchases")}</TabsTrigger>
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
                  <Card className="lift group flex h-full flex-col overflow-hidden rounded-2xl border-slate-800/80 bg-[#0B0F17] p-0 hover:border-emerald-500/50 hover:shadow-[0_12px_35px_rgba(16,185,129,0.18)] transition-all duration-300">
                    {/* Muqova / Artwork Banner */}
                    <div className="relative aspect-video overflow-hidden bg-slate-900 border-b border-slate-800/80">
                      {v.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={v.thumbnailUrl}
                          alt={v.title}
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <CourseCardThumbnail title={v.title} />
                      )}

                      {/* Vignette Overlay */}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 opacity-70" />

                      {/* Floating Badges Bar (Top Left & Top Right) */}
                      <div className="absolute top-2.5 inset-x-2.5 z-20 flex items-center justify-between pointer-events-none">
                        {/* Status Badge */}
                        <div>
                          {isCompleted ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/95 text-slate-950 px-2.5 py-0.5 text-[11px] font-black shadow-[0_2px_8px_rgba(16,185,129,0.4)] backdrop-blur">
                              <CheckCircle2 className="size-3" /> Ko&apos;rilgan
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 text-slate-950 px-2.5 py-0.5 text-[11px] font-black shadow-[0_2px_8px_rgba(245,158,11,0.4)] backdrop-blur">
                              <Sparkles className="size-3" /> Yangi
                            </span>
                          )}
                        </div>

                        {/* Price Badge */}
                        <div>
                          {v.price === 0 ? (
                            <span className="inline-flex items-center rounded-full bg-slate-950/80 border border-emerald-500/50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 shadow backdrop-blur">
                              {t("free")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-950/85 border border-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-white tabular-nums shadow backdrop-blur">
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
                          <span className="grid size-14 place-items-center rounded-full bg-emerald-500 text-slate-950 shadow-[0_0_25px_rgba(16,185,129,0.6)] transition-transform duration-300 group-hover:scale-110">
                            <Play className="size-6 fill-current ml-0.5" />
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Matn va Tafsilotlar Qismi */}
                    <div className="flex flex-1 flex-col p-4 justify-between space-y-3">
                      <div>
                        {/* Meta qatori: Davomiylik & XP */}
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                          <span className="inline-flex items-center gap-1 font-mono text-slate-300">
                            <Clock className="w-3.5 h-3.5 text-emerald-400" />
                            {duration}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/20 shadow-sm">
                            <Sparkles className="w-3 h-3" />
                            +{xpReward} XP
                          </span>
                        </div>

                        {/* Dars sarlavhasi */}
                        <h3 className="line-clamp-2 font-black text-white text-sm sm:text-base leading-snug group-hover:text-emerald-400 transition-colors">
                          {v.title}
                        </h3>

                        {/* Tavsif */}
                        {v.description && (
                          <p className="line-clamp-2 text-xs text-slate-400 mt-1 leading-relaxed">
                            {v.description}
                          </p>
                        )}
                      </div>

                      {/* Harakat tugmalari */}
                      <div className="pt-2 flex flex-wrap items-center gap-2">
                        {v.access === "granted" ? (
                          <>
                            <Button
                              size="sm"
                              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold shadow-md hover:shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                              loading={stream.isPending}
                              onClick={() => onWatch(v)}
                            >
                              <PlaySquare className="w-4 h-4 mr-1.5" />
                              {t("watch")}
                            </Button>
                            {tiedDeckId && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push(`/bamboozle?deck=${tiedDeckId}`)}
                                className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs font-bold"
                              >
                                <Gamepad2 className="w-3.5 h-3.5 mr-1 text-amber-400" />
                                <span>🎮 Bamboozle</span>
                              </Button>
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
                            className="text-slate-500 hover:text-red-400 p-2"
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
        <DialogContent className="max-w-4xl overflow-hidden p-0 bg-[#0B0F17] border border-emerald-500/30 shadow-2xl rounded-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{playing?.title ?? t("watch")}</DialogTitle>
          </DialogHeader>
          {playing && (
            <GamifiedVideoPlayer
              src={playing.url}
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
