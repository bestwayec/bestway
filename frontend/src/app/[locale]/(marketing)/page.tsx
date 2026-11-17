import type { Metadata } from "next";
import { ExpressPlacementTest } from "@/components/placement/ExpressPlacementTest";
import Image from "next/image";
import {
  ArrowRight,
  Award,
  Check,
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
import { TeachersCarousel } from "@/components/marketing/teachers-carousel";
import type { TeacherProfile } from "@/components/marketing/teacher-card";
import PixelCard from "@/components/ui/pixel-card-dynamic";
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
  ielts: { variant: "blue", gap: 12, speed: 32, colors: "#0F2208,#89F336,#BDFD84", active: "#10B981" },
  multilevel: { variant: "yellow", gap: 10, speed: 28, colors: "#3A3510,#FFED29,#FFF580", active: "#FFED29" },
  sat: { variant: "pink", gap: 10, speed: 55, colors: "#3C260D,#FF991C,#FFC268", active: "#FF991C" },
};


export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isEn = locale === "en";
  const tm = await getTranslations({ locale, namespace: "marketing" });
  const title = tm("metaTitle");
  const description = tm("metaDescription");

  return {
    title,
    description,
    keywords: [
      "bestway",
      "best way",
      "bestwayec",
      "bestwayec.uz",
      "bestway education",
      "bestway o'quv markazi",
      "best way english",
      "ielts mock test",
      "cefr mock test",
      "dtm milliy sertifikat",
      "bmb milliy sertifikat",
      "speaking ai tekshirish",
      "writing ai baholash",
    ],
    alternates: {
      canonical: isEn ? "https://bestwayec.uz/en" : "https://bestwayec.uz",
      languages: {
        uz: "https://bestwayec.uz",
        en: "https://bestwayec.uz/en",
      },
    },
    openGraph: {
      title,
      description,
      url: isEn ? "https://bestwayec.uz/en" : "https://bestwayec.uz",
      siteName: "BestWay Education",
      images: [{ url: "/logo-800.png", width: 800, height: 800, alt: "BestWay Education Center" }],
    },
  };
}

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
      {/* ── Hero: what it is, the real exam window, two actions ─────────────── */}
      <section className="marketing-section relative border-b border-border bg-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:py-20">
          <div>
            <p className="text-sm font-semibold text-brand-subtle-fg">{t("heroEyebrow")}</p>
            <h1 className="mt-3 text-[2rem] font-bold leading-[1.15] tracking-tight text-fg sm:text-[2.5rem]">
              {t("heroTitle")}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-fg-muted sm:text-lg">{t("heroSubtitle")}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href="#placement-test" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
                {t("heroCta")}
              </a>
              <Link href={isAuthenticated ? "/dashboard" : "/login"} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-auto")}>
                {isAuthenticated ? t("toDashboard") : t("heroLogin")}
              </Link>
            </div>
            <ul className="mt-8 space-y-2.5 text-sm text-fg-muted">
              {(["heroPoint1", "heroPoint2", "heroPoint3"] as const).map((key) => (
                <li key={key} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* A real screenshot of the exam window (seeded IELTS Academic mock, local stack). */}
          <figure className="min-w-0">
            <div className="overflow-hidden rounded-card border border-border bg-bg-subtle shadow-e3">
              <Image src="/product/exam-light.webp" alt={t("productExamAlt")} width={1366} height={768} priority sizes="(min-width: 1024px) 640px, 100vw" className="block h-auto w-full dark:hidden" />
              <Image src="/product/exam-dark.webp" alt={t("productExamAlt")} width={1366} height={768} priority sizes="(min-width: 1024px) 640px, 100vw" className="hidden h-auto w-full dark:block" />
            </div>
            <figcaption className="mt-3 text-sm text-fg-subtle">{t("productExamCaption")}</figcaption>
          </figure>
        </div>
      </section>
      <section id="placement-test" className="marketing-section border-b border-border bg-bg-subtle scroll-mt-20">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
          <ExpressPlacementTest isAuthenticated={isAuthenticated} />
        </div>
      </section>

      {/* ── What you get: three real parts of the product ───────────────────── */}
      <section id="product" className="marketing-section border-b border-border bg-surface scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <SectionHeading title={t("productTitle")} subtitle={t("productSubtitle")} />
          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            {([
              { key: "exam", href: "/mock" },
              { key: "result", href: "/mock" },
              { key: "teacher", href: "/login" },
            ] as const).map(({ key, href }, i) => (
              <article key={key} className="flex flex-col">
                <p className="text-sm font-semibold tabular-nums text-fg-subtle">0{i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold text-fg">{t(`product.${key}Title`)}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">{t(`product.${key}Text`)}</p>
                <Link href={href} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
                  {t(`product.${key}Link`)} <ArrowRight className="size-4" aria-hidden />
                </Link>
              </article>
            ))}
          </div>
          {/* A sample result: synthetic student and exam on the local stack, labelled as such. */}
          <figure className="mx-auto mt-12 max-w-3xl">
            <div className="overflow-hidden rounded-card border border-border bg-surface shadow-e2">
              <Image src="/product/result-light.webp" alt={t("productResultAlt")} width={766} height={203} sizes="(min-width: 768px) 768px, 100vw" className="block h-auto w-full dark:hidden" />
              <Image src="/product/result-dark.webp" alt={t("productResultAlt")} width={766} height={203} sizes="(min-width: 768px) 768px, 100vw" className="hidden h-auto w-full dark:block" />
            </div>
            <figcaption className="mt-3 text-center text-sm text-fg-subtle">{t("productResultCaption")}</figcaption>
          </figure>
        </div>
      </section>

      {/* ── Kurslar ──────────────────────────────────────────────────────── */}
      <section id="courses" className="marketing-section border-b border-border bg-surface scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal>
            <SectionHeading title={t("coursesTitle")} subtitle={t("coursesSubtitle")} />
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
      {/* Shown only when real teacher profiles exist (no "coming soon" placeholder). */}
      {teachers.length > 0 && (
      <section id="teachers" className="marketing-section scroll-mt-16 overflow-x-clip">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
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
      )}

      {/* ── Nega biz ─────────────────────────────────────────────────────── */}
      <section id="why" className="marketing-section border-t border-border bg-bg-subtle scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal>
            <SectionHeading title={t("whyTitle")} subtitle={t("whySubtitle")} />
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {FEATURES.map(({ key, Icon, tone }, i) => (
              <Reveal key={key} delay={i * 70}>
                <div className="group flex gap-4 rounded-2xl border border-border bg-surface p-5 transition-all duration-200 hover:border-border-strong hover:bg-surface-hover hover:shadow-md">
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
            <div className="relative mt-4 h-[380px] overflow-hidden rounded-dialog border border-border shadow-lg sm:h-[440px]">
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
    <TiltCard maxTilt={5} className="h-full rounded-dialog">
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
