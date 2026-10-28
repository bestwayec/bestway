import { ExpressPlacementTest } from "@/components/placement/ExpressPlacementTest";
import { Play, Zap } from "lucide-react";
import {
  ArrowRight,
  Award,
  BarChart3,
  CalendarCheck,
  FileCheck2,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  Star,
  Wallet,
} from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { TiltCard } from "@/components/ui/tilt-card";
import { Reveal } from "@/components/marketing/reveal";
import { CountUp } from "@/components/marketing/count-up";
import { HeroShowcase } from "@/components/marketing/hero-showcase";
import { TeachersCarousel } from "@/components/marketing/teachers-carousel";
import type { TeacherProfile } from "@/components/marketing/teacher-card";
import PixelCard from "@/components/ui/pixel-card-dynamic";
import { HeroTitle } from "@/components/marketing/hero-title";
import CenterMap from "@/components/marketing/center-map-dynamic";
import { getSessionRole } from "@/lib/auth";
import { MobileLandingGate } from "@/components/mobile/mobile-landing-gate";
import { getGalleryImages, getLatestArticles, getTeachersPublic } from "@/lib/public-api";
import { CENTER } from "@/lib/config";
import { cn, formatPhone } from "@/lib/utils";

const COURSES = [
  { key: "ielts", Icon: Award, tone: "brand" },
  { key: "multilevel", Icon: BarChart3, tone: "accent" },
  { key: "sat", Icon: GraduationCap, tone: "orange" },
] as const;

const FEATURES = [
  { key: "attendance", Icon: CalendarCheck, tone: "brand" },
  { key: "points", Icon: Star, tone: "accent" },
  { key: "tests", Icon: FileCheck2, tone: "orange" },
  { key: "payments", Icon: Wallet, tone: "brand" },
] as const;

const STATS = [
  { num: 500, suffix: "+", key: "statsStudents" },
  { num: 7, suffix: "+", key: "statsTeachers" },
  { num: 17, suffix: "+", key: "statsYears" },
] as const;

// TEACHERS section renders TeacherProfileCard carousel from gallery / teachers API data.

const TONE_TILE: Record<string, string> = {
  brand: "bg-brand-subtle text-brand-subtle-fg",
  accent: "bg-accent-subtle text-brand",
  orange: "bg-orange-subtle text-orange",
};

/** PixelCard props per course — each card gets its own variant / colors
 *  to demonstrate the `variant`, `gap`, `speed` and `colors` props. */
const COURSE_PIXEL: Record<
  (typeof COURSES)[number]["key"],
  { variant: "default" | "blue" | "yellow" | "pink"; gap: number; speed: number; colors: string; active: string }
> = {
  ielts: { variant: "blue", gap: 12, speed: 32, colors: "#064E3B,#10B981,#34D399", active: "#10B981" },
  multilevel: { variant: "yellow", gap: 10, speed: 28, colors: "#3A3510,#FFED29,#FFF580", active: "#FFED29" },
  sat: { variant: "pink", gap: 10, speed: 55, colors: "#3C260D,#FF991C,#FFC268", active: "#FF991C" },
};

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Parallel fetch — avoids sequential waterfall that added 600ms+ to TTFB
  const [t, format, articles, galleryImages, role] = await Promise.all([
    getTranslations("marketing"),
    getFormatter(),
    getLatestArticles(3),
    getGalleryImages(),
    getSessionRole(),
  ]);
  const isAuthenticated = !!role;
  const teachersFallback = galleryImages.length === 0 ? await getTeachersPublic() : [];
  // Teacher cards render from real CMS data: gallery labels ("Name — IELTS 8.5")
  // or `/teachers` records (name / specialty / achievement / photo).
  const teachers: TeacherProfile[] =
    galleryImages.length > 0
      ? galleryImages.map((g) => {
          const { name, achievement } = splitGalleryLabel(g.label);
          return {
            id: g.id,
            name: name || t("teachersDefaultName"),
            achievement,
            photoUrl: g.image,
            profileUrl: g.link,
          };
        })
      : teachersFallback.map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          title: teacher.specialty,
          achievement: teacher.achievement,
          photoUrl: teacher.photoUrl,
          profileUrl: teacher.socialUrl,
        }));

  return (
    <MobileLandingGate locale={locale} isAuthenticated={isAuthenticated}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="marketing-section relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="bg-grid absolute inset-0 opacity-40" />
          <div className="anim-float absolute -top-24 left-[4%] size-56 rounded-full bg-brand/10 blur-3xl sm:size-72" />
          <div className="anim-float-slow absolute top-8 right-[2%] hidden size-80 rounded-full bg-accent/10 blur-3xl sm:block" />
          <div className="anim-float absolute -bottom-16 left-1/3 hidden size-64 rounded-full bg-highlight/10 blur-3xl sm:block" />
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand via-accent to-orange" />
        </div>

        <div className="mx-auto grid max-w-6xl items-center gap-6 px-4 py-8 sm:gap-10 sm:px-6 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-8 lg:py-24 xl:max-w-7xl">
          <div className="order-2 text-center lg:order-1 lg:text-left">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-semibold tracking-wide uppercase shadow-[0_0_20px_rgba(16,185,129,0.2)] mb-4">
              <span>✨ BestWay LMS</span>
              <span className="text-slate-500">•</span>
              <span>Do your best, forget the rest!</span>
            </div>
            <h1 className="mt-2 min-h-[2.2em] overflow-visible pt-1 text-[2rem] leading-[1.1] font-extrabold tracking-tight text-pretty bg-gradient-to-r from-white via-emerald-100 to-emerald-400 bg-clip-text text-transparent sm:text-5xl lg:text-[3.25rem] lg:leading-[1.08]">
              <HeroTitle text={t("heroTitle")} />
            </h1>
            <Reveal delay={180}>
              <p className="mx-auto mt-5 max-w-xl text-base text-pretty text-fg-muted sm:text-lg lg:mx-0 lg:max-w-2xl">
                {t("heroSubtitle")}
              </p>
            </Reveal>
            <Reveal delay={270}>
              <div className="mt-8 flex w-full flex-col flex-wrap items-center justify-center gap-3 sm:w-auto sm:flex-row lg:justify-start">
                <a
                  href="#placement-test"
                  className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-7 py-3.5 text-base font-bold text-white shadow-xl shadow-emerald-950/60 transition-all duration-200 hover:from-emerald-400 hover:to-emerald-500 hover:scale-[1.03] active:scale-95"
                >
                  <Zap className="size-5 fill-current" />
                  <span>{t("heroCta")}</span>
                </a>
                <Link
                  href="/mock"
                  className={cn(
                    buttonVariants({ size: "lg", variant: "outline" }),
                    "rounded-2xl border-slate-700 bg-slate-900/60 px-6 py-3.5 text-slate-200 hover:border-emerald-500/50 hover:bg-slate-800 transition-all duration-200 hover:scale-[1.03] active:scale-95",
                  )}
                >
                  <Award className="size-4 text-emerald-400 mr-2" />
                  {t("heroSecondary")}
                </Link>
              </div>
            </Reveal>

            <Reveal delay={360}>
              <dl className="mx-auto mt-12 grid max-w-md grid-cols-3 gap-2 sm:gap-4 lg:mx-0 lg:max-w-lg">
                {STATS.map((s) => (
                  <div key={s.key}>
                    <dt className="bg-gradient-to-br from-brand to-accent bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
                      <CountUp end={s.num} suffix={s.suffix} />
                    </dt>
                    <dd className="mt-1 text-xs text-fg-muted sm:text-sm">{t(s.key)}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          {/* Learning progress visual — mobile: first (visible on main screen); desktop: right column.
              Plain div (no Reveal): hero is above the fold, scroll-reveal keeps
              opacity:0 until scrolled and hides the 3D logo on phones. */}
          <div className="relative order-1 lg:order-2">
            <HeroShowcase />
          </div>
        </div>
      </section>
      {/* ── 10-Minute Express Placement Test (Phase 4) ──────────────────── */}
      <section id="placement-test" className="marketing-section scroll-mt-20">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-16">
          <ExpressPlacementTest isAuthenticated={isAuthenticated} />
        </div>
      </section>

      {/* ── Ekotizim Vitrinasi & Social Proof ─────────────────────────── */}
      <section className="marketing-section marketing-section--tint scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <Reveal>
            <SectionHeading
              title={t("ecosystem.title")}
              subtitle={t("ecosystem.subtitle")}
            />
          </Reveal>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1: 29+ Video Lessons */}
            <Reveal delay={0} className="h-full">
              <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl border border-slate-800/80 bg-[#111827] p-6 shadow-xl transition-all duration-300 hover:border-emerald-500/50 hover:shadow-2xl hover:shadow-emerald-950/30">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600 transition-transform duration-300 group-hover:scale-x-100"
                />
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 transition-transform duration-300 group-hover:scale-110">
                      <Play className="size-6 fill-current" />
                    </span>
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-950/50 px-3 py-1 text-xs font-semibold text-emerald-400">
                      v1.0.6
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white">{t("ecosystem.f1Title")}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-300">
                    {t("ecosystem.f1Text")}
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-800/80">
                  <Link
                    href="/videos"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition"
                  >
                    <span>Darslar katalogiga o'tish</span>
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
              </div>
            </Reveal>

            {/* Feature 2: CDI & Multi-Level Simulator */}
            <Reveal delay={100} className="h-full">
              <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl border border-slate-800/80 bg-[#111827] p-6 shadow-xl transition-all duration-300 hover:border-teal-500/50 hover:shadow-2xl hover:shadow-teal-950/30">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-teal-500 via-emerald-400 to-teal-600 transition-transform duration-300 group-hover:scale-x-100"
                />
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-teal-950/60 border border-teal-500/30 text-teal-400 transition-transform duration-300 group-hover:scale-110">
                      <Award className="size-6" />
                    </span>
                    <span className="rounded-full border border-teal-500/30 bg-teal-950/50 px-3 py-1 text-xs font-semibold text-teal-300">
                      Vision OCR
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white">{t("ecosystem.f2Title")}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-300">
                    {t("ecosystem.f2Text")}
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-800/80">
                  <Link
                    href="/mock"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-teal-400 hover:text-teal-300 transition"
                  >
                    <span>Imtihon topshirish</span>
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
              </div>
            </Reveal>

            {/* Feature 3: Teacher Workspace */}
            <Reveal delay={200} className="h-full">
              <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl border border-slate-800/80 bg-[#111827] p-6 shadow-xl transition-all duration-300 hover:border-emerald-500/50 hover:shadow-2xl hover:shadow-emerald-950/30">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600 transition-transform duration-300 group-hover:scale-x-100"
                />
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 transition-transform duration-300 group-hover:scale-110">
                      <GraduationCap className="size-6" />
                    </span>
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-950/50 px-3 py-1 text-xs font-semibold text-emerald-400">
                      Smart Analytics
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white">{t("ecosystem.f3Title")}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-300">
                    {t("ecosystem.f3Text")}
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-800/80">
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition"
                  >
                    <span>Kabinetga kirish</span>
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>


      {/* ── Kurslar ──────────────────────────────────────────────────────── */}
      <section id="courses" className="marketing-section marketing-section--tint scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <Reveal>
            <SectionHeading title={t("coursesTitle")} subtitle={t("coursesSubtitle")} />
          </Reveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {COURSES.map(({ key, Icon, tone }, i) => {
              const cfg = COURSE_PIXEL[key];
              return (
                <Reveal key={key} delay={i * 90} className="h-full">
                  <PixelCard
                    variant={cfg.variant}
                    gap={cfg.gap}
                    speed={cfg.speed}
                    colors={cfg.colors}
                    className="pixel-card--course group hover-elevate hover:border-border-strong focus-within:border-border-strong"
                    style={{ "--pixel-card-active-color": cfg.active } as React.CSSProperties}
                  >
                    {/* top gradient line — replicates FancyCard accent, animates on group-hover */}
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-0 z-10 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-brand via-accent to-orange transition-transform duration-300 group-hover:scale-x-100 group-focus-within:scale-x-100"
                    />
                    <div className="pixel-card__content">
                      <span
                        className={cn(
                          "inline-flex size-12 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6",
                          TONE_TILE[tone],
                        )}
                      >
                        <Icon className="size-6" />
                      </span>
                      <h3 className="mt-4 text-lg font-semibold text-fg">{t(`courseList.${key}.name`)}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                        {t(`courseList.${key}.desc`)}
                      </p>
                    </div>
                  </PixelCard>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── O'qituvchilar (TeacherProfileCard carousel) ─────────────────────── */}
      <section id="teachers" className="marketing-section scroll-mt-16 overflow-x-clip">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <Reveal>
            <SectionHeading title={t("teachersTitle")} subtitle={t("teachersSubtitle")} />
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-10">
              <TeachersCarousel teachers={teachers} />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Nega biz ─────────────────────────────────────────────────────── */}
      <section id="why" className="marketing-section marketing-section--tint scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <Reveal>
            <SectionHeading title={t("whyTitle")} subtitle={t("whySubtitle")} />
          </Reveal>
          <div className="mt-12 grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {FEATURES.map(({ key, Icon, tone }, i) => (
              <Reveal key={key} delay={i * 70}>
                <div className="group flex gap-4 rounded-2xl p-4 transition-colors hover:bg-surface">
                  <span
                    className={cn(
                      "inline-flex size-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110",
                      TONE_TILE[tone],
                    )}
                  >
                    <Icon className="size-6" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-fg">{t(`features.${key}Title`)}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                      {t(`features.${key}Text`)}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Yangiliklar ──────────────────────────────────────────────────── */}
      {articles.length > 0 && (
        <section id="news" className="marketing-section scroll-mt-16">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <Reveal>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <SectionHeading align="left" title={t("newsTitle")} subtitle={t("newsSubtitle")} />
                <Link
                  href="/news"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")}
                >
                  {t("allNews")}
                  <ArrowRight />
                </Link>
              </div>
            </Reveal>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((a, i) => (
                <Reveal key={a.id} delay={i * 90}>
                  <Link href={`/news/${a.id}`} className="group block h-full min-w-0">
                    <FancyCard>
                      {a.category && (
                        <span className="block truncate text-xs font-semibold tracking-wide text-orange uppercase">
                          {a.category}
                        </span>
                      )}
                      <h3 className="mt-2 line-clamp-2 text-lg font-semibold break-words text-fg">{a.title}</h3>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed break-words text-fg-muted">{a.body}</p>
                      <time className="mt-4 block text-xs text-fg-subtle">
                        {format.dateTime(new Date(a.createdAt), { day: "numeric", month: "long", year: "numeric" })}
                      </time>
                    </FancyCard>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Aloqa ────────────────────────────────────────────────────────── */}
      <section id="contact" className="marketing-section scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <Reveal>
            <SectionHeading title={t("contactTitle")} subtitle={t("contactSubtitle")} />
          </Reveal>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Reveal>
              <ContactCard
                icon={<Phone className="size-5" />}
                label={t("callUs")}
                tone="brand"
                lines={[
                  { text: formatPhone(CENTER.phone), href: `tel:${CENTER.phone.replace(/\s/g, "")}` },
                ]}
              />
            </Reveal>
            <Reveal delay={90}>
              <ContactCard
                icon={<Mail className="size-5" />}
                label={t("writeUs")}
                tone="accent"
                lines={[{ text: CENTER.email, href: `mailto:${CENTER.email}` }]}
              />
            </Reveal>
            <Reveal delay={180}>
              <FancyCard className="sm:col-span-2 lg:col-span-1">
                <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-orange-subtle text-orange">
                  <MapPin className="size-5" />
                </span>
                <p className="mt-3 text-sm font-medium text-fg-muted">{t("visitUs")}</p>
                <p className="mt-1 font-semibold text-fg">{CENTER.address}</p>
                <a
                  href={CENTER.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}
                >
                  <MapPin />
                  {t("directions")}
                </a>
              </FancyCard>
            </Reveal>
          </div>

          {/* Live map — client-only Leaflet, lazy-loaded below the fold. */}
          <Reveal delay={120}>
            <div className="relative mt-4 h-[380px] overflow-hidden rounded-[18px] border border-border shadow-lg sm:h-[440px]">
              <CenterMap
                regionLabel={t("mapRegionLabel")}
                findUsLabel={t("mapFindUs")}
                directionsLabel={t("mapGetDirections")}
                callLabel={t("mapCall")}
                recenterLabel={t("mapRecenter")}
              />
            </div>
          </Reveal>

          {/* Asoschi + tashkil etilgan yil */}
          <Reveal delay={120}>
            <div className="mt-6 flex flex-col items-center justify-center gap-x-10 gap-y-3 rounded-2xl border border-border bg-bg-subtle px-6 py-5 text-center sm:flex-row">
              <div>
                <p className="text-xs tracking-wide text-fg-subtle uppercase">{t("founderLabel")}</p>
                <p className="mt-0.5 font-semibold text-fg">{CENTER.founder}</p>
              </div>
              <div className="hidden h-8 w-px bg-border sm:block" />
              <div>
                <p className="text-xs tracking-wide text-fg-subtle uppercase">{t("foundedLabel")}</p>
                <p className="mt-0.5 font-semibold text-fg tabular-nums">{CENTER.established}</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </MobileLandingGate>
  );
}

/** 3D egiladigan, yorug'lik o'tadigan va yuqori gradient chiziqli karta */
function FancyCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TiltCard maxTilt={5} className="h-full rounded-[18px]">
      <Card
        className={cn(
          "shine hover-elevate group relative flex h-full flex-col overflow-hidden p-6 transition-colors duration-300 hover:border-border-strong",
          className,
        )}
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-brand via-accent to-orange transition-transform duration-300 group-hover:scale-x-100"
        />
        {children}
      </Card>
    </TiltCard>
  );
}

function ContactCard({
  icon,
  label,
  tone,
  lines,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "brand" | "accent";
  lines: { text: string; href: string }[];
}) {
  return (
    <FancyCard>
      <span className={cn("inline-flex size-11 items-center justify-center rounded-2xl", TONE_TILE[tone])}>
        {icon}
      </span>
      <p className="mt-3 text-sm font-medium text-fg-muted">{label}</p>
      <div className="mt-1 space-y-1">
        {lines.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="block text-lg font-bold text-fg tabular-nums transition-colors hover:text-brand"
          >
            {l.text}
          </a>
        ))}
      </div>
    </FancyCard>
  );
}
/** Gallery labels look like "Sardor Karimov — IELTS 8.5": name + proof. */
function splitGalleryLabel(label?: string): { name: string; achievement?: string } {
  if (!label) return { name: "" };
  const parts = label.split(/\s+[—–-]\s+/).map((p) => p.trim());
  const [name, ...rest] = parts;
  const achievement = rest.join(" — ").trim();
  return { name: name ?? "", achievement: achievement || undefined };
}

function SectionHeading({
  title,
  subtitle,
  align = "center",
}: {
  title: string;
  subtitle: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <h2 className="text-2xl font-bold tracking-tight text-balance text-fg sm:text-3xl">{title}</h2>
      <p className="mt-3 text-pretty text-fg-muted">{subtitle}</p>
    </div>
  );
}
