"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Brand } from "@/components/brand";
import { navForRole, isActive } from "@/lib/nav";
import { CENTER } from "@/lib/config";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Yon panel holati — sahifa yangilanganda ham saqlanadi */
const COLLAPSED_KEY = "bw-sidebar-collapsed";

const collapsedListeners = new Set<() => void>();

function readCollapsedSetting(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    /* private mode — o'qib bo'lmaydi, panel ochiq qoladi */
    return false;
  }
}

function subscribeCollapsedSetting(onChange: () => void) {
  collapsedListeners.add(onChange);
  // Boshqa tablarda o'zgarsa ham sinxronlashadi
  window.addEventListener("storage", onChange);
  return () => {
    collapsedListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeCollapsedSetting(next: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  } catch {
    /* private mode — saqlanmaydi, lekin panel ishlaydi */
  }
  collapsedListeners.forEach((notify) => notify());
}

export function AppSidebar({ role }: { role: Role }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const items = navForRole(role);
  // Browser-only state via external store: SSR always renders expanded
  // (matches server HTML), client restores the saved state after hydration.
  const collapsed = React.useSyncExternalStore(
    subscribeCollapsedSetting,
    readCollapsedSetting,
    () => false,
  );

  const toggle = React.useCallback(() => {
    writeCollapsedSetting(!collapsed);
  }, [collapsed]);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      {/* logo + nozik yashil yog'du */}
      <div
        className={cn(
          "relative flex h-16 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 left-0 h-24 w-40 rounded-full bg-brand/10 blur-2xl"
        />
        <Link href="/" aria-label={CENTER.name} className="relative transition-transform hover:scale-[1.02]">
          {collapsed ? <Brand variant="mark" showText={false} size="sm" /> : <Brand />}
        </Link>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? t(item.key) : undefined}
              aria-label={collapsed ? t(item.key) : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-all duration-200",
                collapsed && "justify-center px-2",
                active
                  ? "bg-brand-subtle text-brand-subtle-fg"
                  : "text-fg-muted hover:translate-x-0.5 hover:bg-surface-hover hover:text-fg",
              )}
            >
              {/* chapdagi faol ko'rsatkich */}
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-all duration-200",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-40",
                )}
              />
              <Icon
                className={cn(
                  "size-[18px] shrink-0 transition-transform duration-200",
                  active ? "text-brand" : "group-hover:scale-110",
                )}
              />
              {!collapsed && t(item.key)}
            </Link>
          );
        })}
      </nav>

      {/* pastki: brend + yig'ish/ochish strelkasi */}
      <div
        className={cn(
          "flex items-center gap-2 border-t border-border py-3",
          collapsed ? "justify-center px-2" : "justify-between px-5",
        )}
      >
        {!collapsed && (
          <p className="truncate text-xs text-fg-subtle">
            {CENTER.name} · <span className="text-fg-muted">{CENTER.established}</span>
          </p>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "expandSidebar" : "collapseSidebar")}
          title={t(collapsed ? "expandSidebar" : "collapseSidebar")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>
    </aside>
  );
}
