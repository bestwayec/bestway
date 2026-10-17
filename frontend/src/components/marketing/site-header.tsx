"use client";

import * as React from "react";
import { Menu, MonitorDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { JellyNav } from "@/components/ui/jelly-nav";
import { SpecularButton } from "@/components/ui/specular-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/feedback";
import { useMe } from "@/hooks/use-me";
import { cn } from "@/lib/utils";
import { homePathForRole } from "@/lib/role-routing";

const SECTIONS = [
  { hash: "courses", key: "navCourses" },
  { hash: "teachers", key: "navTeachers" },
  { hash: "why", key: "navWhy" },
  { hash: "news", key: "navNews" },
  { hash: "contact", key: "navContact" },
] as const;

/** rAF-throttled scroll subscription for useSyncExternalStore (header shade). */
function subscribeScrollPosition(onChange: () => void) {
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      onChange();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => window.removeEventListener("scroll", onScroll);
}

export function SiteHeader() {
  const t = useTranslations("marketing");
  const router = useRouter();
  const { data: me, isLoading: meLoading } = useMe();
  const isLoggedIn = !!me?.user;
  const [open, setOpen] = React.useState(false);
  // Scroll position is external browser state: useSyncExternalStore keeps the
  // SSR HTML (not scrolled) and the client in sync with no hydration mismatch.
  const scrolled = React.useSyncExternalStore(
    subscribeScrollPosition,
    () => window.scrollY > 8,
    () => false,
  );
  const [activeIdx, setActiveIdx] = React.useState(0);

  // Sync active pill with URL hash and visible section (scroll spy).
  // Position-based (not IntersectionObserver): the active item is the last
  // section whose top is above 40% of the viewport. Above the first section
  // (hero) this yields index 0 instead of a stale section — the observer
  // version never cleared, so scrolling back to hero kept e.g. "Benefits".
  // Off the home page (no section elements in DOM) there is no selection.
  React.useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const idx = SECTIONS.findIndex((s) => s.hash === hash);
      if (idx >= 0) setActiveIdx(idx);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);

    let ticking = false;
    const update = () => {
      ticking = false;
      const existing = SECTIONS.filter((s) => document.getElementById(s.hash));
      if (existing.length === 0) {
        setActiveIdx(-1);
        return;
      }
      const line = window.scrollY + window.innerHeight * 0.4;
      let idx = 0;
      existing.forEach((s) => {
        const el = document.getElementById(s.hash);
        if (el && el.getBoundingClientRect().top + window.scrollY <= line) {
          idx = SECTIONS.indexOf(s);
        }
      });
      setActiveIdx(idx);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled ? "border-border" : "border-transparent",
      )}
    >
      {/* Persistent frosted layer gated by opacity (never toggles backdrop-filter:
          dynamically adding backdrop-filter to a sticky header during a locale
          re-render leaves Chromium with an unpainted layer until the next
          invalidation — header "disappears" until any click repaints it). */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70 transition-opacity duration-300",
          scrolled ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-brand via-accent to-orange transition-opacity duration-300",
          scrolled ? "opacity-80" : "opacity-30",
        )}
      />
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 lg:gap-4">
        <Link
          href="/"
          aria-label="Best Way"
          className="shrink-0 transition-transform hover:scale-[1.03]"
        >
          <Brand size="md" />
        </Link>

        {/* Desktop navigation — springy jelly selector. */}
        {/* xl breakpoint keeps longer navigation labels from overlapping brand/actions. */}
        <div className="hidden min-w-0 flex-1 justify-center overflow-hidden xl:flex">
          <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <JellyNav
              items={SECTIONS.map((section) => ({
                value: section.hash,
                label: t(section.key),
              }))}
              value={SECTIONS[activeIdx]?.hash ?? ""}
              onChange={(hash, index) => {
                setActiveIdx(index);
                router.push(`/#${hash}`);
              }}
              ariaLabel="Main navigation"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" asChild title={t("desktopApp")}>
            <Link href="/desktop" aria-label={t("desktopApp")}>
              <MonitorDown />
            </Link>
          </Button>
          <div className="hidden items-center gap-1.5 sm:flex">
            <LanguageSwitcher />
          </div>
          {meLoading ? (
            <Skeleton className="hidden size-9 rounded-full sm:inline-flex" />
          ) : isLoggedIn ? (
            <Link
              href={homePathForRole(me.user.role)}
              aria-label={me.user.name}
              className="hidden items-center gap-2 sm:inline-flex rounded-full p-1 transition-colors hover:bg-surface-hover"
            >
              <Avatar name={me.user.name} size="sm" />
            </Link>
          ) : (
            <div className="hidden items-center gap-1.5 sm:flex">
              <SpecularButton
                size="sm"
                radius={12}
                tint="#ffffff"
                tintOpacity={0}
                textColor="var(--fg-muted)"
                lineColor="#FFED29"
                baseColor="#303321"
                intensity={1}
                shineSize={10}
                shineFade={40}
                thickness={1.2}
                onClick={() => router.push("/login")}
              >
                {t("login")}
              </SpecularButton>
              <SpecularButton
                size="sm"
                radius={12}
                tint="#89F336"
                tintOpacity={1}
                textColor="#101704"
                lineColor="#FFED29"
                baseColor="#4E9F1E"
                intensity={1.2}
                shineSize={10}
                shineFade={40}
                thickness={1.2}
                onClick={() => router.push("/register")}
                className="shadow-sm"
              >
                {t("heroCta")}
              </SpecularButton>
            </div>
          )}

          {/* Mobil menyu tugmasi */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="xl:hidden"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      {/* Mobil ochiladigan panel */}
      {open && (
        <div className="anim-fade relative max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t border-border bg-bg/95 backdrop-blur-md xl:hidden" data-state="open">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 sm:px-6">
            <Link
              href="/desktop"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <MonitorDown className="size-4 shrink-0 text-brand" aria-hidden />
              {t("desktopApp")}
            </Link>
            {SECTIONS.map((s) => (
              <Link
                key={s.hash}
                href={`/#${s.hash}`}
                onClick={() => setOpen(false)}
                className="rounded-[10px] px-3 py-2.5 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                {t(s.key)}
              </Link>
            ))}
            <div className="my-2 h-px bg-border" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <LanguageSwitcher />
              </div>
              <div className="flex items-center gap-2">
                {meLoading ? (
                  <Skeleton className="size-9 rounded-full" />
                ) : isLoggedIn ? (
                  <Link
                    href={homePathForRole(me.user.role)}
                    aria-label={me.user.name}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-surface-hover"
                  >
                    <Avatar name={me.user.name} size="sm" />
                    <span className="pr-2 text-sm font-medium text-fg">{me.user.name}</span>
                  </Link>
                ) : (
                  <>
                    <SpecularButton
                      size="sm"
                      radius={12}
                      tint="#ffffff"
                      tintOpacity={0}
                      textColor="var(--fg)"
                      lineColor="#FFED29"
                      baseColor="#303321"
                      intensity={1}
                      shineSize={10}
                      shineFade={40}
                      thickness={1.2}
                      onClick={() => {
                        setOpen(false);
                        router.push("/login");
                      }}
                    >
                      {t("login")}
                    </SpecularButton>
                    <SpecularButton
                      size="sm"
                      radius={12}
                      tint="#89F336"
                      tintOpacity={1}
                      textColor="#101704"
                      lineColor="#FFED29"
                      baseColor="#4E9F1E"
                      intensity={1.2}
                      shineSize={10}
                      shineFade={40}
                      thickness={1.2}
                      onClick={() => {
                        setOpen(false);
                        router.push("/register");
                      }}
                    >
                      {t("heroCta")}
                    </SpecularButton>
                  </>
                )}
              </div>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
