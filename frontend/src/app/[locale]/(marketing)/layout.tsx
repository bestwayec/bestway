import { setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import ParticleBackdrop from "@/components/marketing/particle-backdrop-dynamic";
import { getGalleryImages, getLatestArticles, getTeachersPublic } from "@/lib/public-api";

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The landing page hides its Teachers and News sections when there is nothing real to show;
  // the menu must not link to them then. Same cached public requests as the page (5 min).
  const [articles, gallery] = await Promise.all([getLatestArticles(3), getGalleryImages()]);
  const hasTeachers = gallery.length > 0 || (await getTeachersPublic()).length > 0;
  const hidden = [...(hasTeachers ? [] : ["teachers"]), ...(articles.length > 0 ? [] : ["news"])];

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      {/* Ambient particle field — fixed above the gradient base (body::before),
          below all content. pointer-events-none so it never blocks taps. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-[1] opacity-40 sm:opacity-55"
      >
        <ParticleBackdrop />
      </div>
      <div className="mobile-app-hide">
        <SiteHeader hidden={hidden} />
      </div>
      <main className="flex-1 overflow-x-clip">{children}</main>
      <div className="mobile-app-hide">
        <SiteFooter />
      </div>
    </div>
  );
}
