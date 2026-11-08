"use client";

import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Brand } from "@/components/brand";
import { primaryNavForRole, secondaryNavForRole, isActive } from "@/lib/nav";
import { CENTER } from "@/lib/config";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

/** Yon panel holati — sahifa yangilanganda ham saqlanadi */
const COLLAPSED_KEY = "bw-sidebar-collapsed";

const collapsedListeners = new Set<() => void>();

function readCollapsedSetting(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeCollapsedSetting(onChange: () => void) {
  collapsedListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    collapsedListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeCollapsedSetting(next: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  } catch {}
  collapsedListeners.forEach((notify) => notify());
}

export function AppSidebar({ role }: { role: Role }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const primary = primaryNavForRole(role);
  const secondary = secondaryNavForRole(role);
  const [moreExpanded, setMoreExpanded] = React.useState(false);

  const collapsed = React.useSyncExternalStore(
    subscribeCollapsedSetting,
    readCollapsedSetting,
    () => false,
  );

  const toggle = React.useCallback(() => {
    writeCollapsedSetting(!collapsed);
  }, [collapsed]);

  const hasSecondary = secondary.length > 0;
  const isSecondaryActive = secondary.some((item) => isActive(pathname, item.href));

  React.useEffect(() => {
    if (isSecondaryActive) {
      setMoreExpanded(true);
    }
  }, [isSecondaryActive]);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      {/* Oddiy, toza logo qismi — glow va soya olib tashlangan */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <Link href="/" aria-label={CENTER.name} className="transition-transform hover:opacity-90">
          {collapsed ? <Brand variant="mark" showText={false} size="sm" /> : <Brand />}
        </Link>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-3">
        {/* Asosiy 4 ta band */}
        {primary.map((item) => {
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
                "group relative flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm font-medium transition-colors",
                collapsed && "justify-center px-2",
                active
                  ? "bg-brand-subtle text-brand-subtle-fg font-semibold"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon
                className={cn(
                  "size-[18px] shrink-0",
                  active ? "text-brand" : "text-fg-muted group-hover:text-fg",
                )}
              />
              {!collapsed && <span>{t(item.key)}</span>}
            </Link>
          );
        })}

        {/* Yana (Secondary) bo'limi */}
        {hasSecondary && (
          <div className="pt-2">
            {!collapsed ? (
              <div className="rounded-[12px] border border-border/60 bg-bg-subtle/50 p-1">
                <button
                  type="button"
                  onClick={() => setMoreExpanded(!moreExpanded)}
                  aria-expanded={moreExpanded}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[8px] px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                    isSecondaryActive ? "text-brand" : "text-fg-muted hover:text-fg",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <MoreHorizontal className="size-3.5" />
                    {t("more")}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform duration-200",
                      moreExpanded && "rotate-180",
                    )}
                  />
                </button>
                {moreExpanded && (
                  <div className="mt-1 space-y-1 pt-1">
                    {secondary.map((item) => {
                      const active = isActive(pathname, item.href);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-3 rounded-[8px] px-2.5 py-2 text-sm transition-colors",
                            active
                              ? "bg-brand-subtle text-brand-subtle-fg font-medium"
                              : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                          )}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span>{t(item.key)}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1 border-t border-border/60 pt-2">
                {secondary.map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={t(item.key)}
                      aria-label={t(item.key)}
                      className={cn(
                        "flex items-center justify-center rounded-[12px] p-2 text-sm transition-colors",
                        active
                          ? "bg-brand-subtle text-brand-subtle-fg"
                          : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Pastki panel: brend, tema almashtirish, yig'ish/ochish */}
      <div
        className={cn(
          "flex items-center gap-2 border-t border-border py-3",
          collapsed ? "flex-col justify-center px-2" : "justify-between px-5",
        )}
      >
        {!collapsed && (
          <p className="truncate text-xs text-fg-subtle">
            {CENTER.name} · <span className="text-fg-muted">{CENTER.established}</span>
          </p>
        )}
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={t(collapsed ? "expandSidebar" : "collapseSidebar")}
            title={t(collapsed ? "expandSidebar" : "collapseSidebar")}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
