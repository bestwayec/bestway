"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { groupedNavForRole, isActive, type NavItem, type NavSectionId } from "@/lib/nav";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Sections the user folded, remembered per browser. Sections not listed are open (predictable default). */
const FOLDED_KEY = "bw-sidebar-folded";
const listeners = new Set<() => void>();

function readFolded(): string {
  try {
    return window.localStorage.getItem(FOLDED_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeFolded(ids: string[]) {
  try {
    window.localStorage.setItem(FOLDED_KEY, ids.join(","));
  } catch {}
  listeners.forEach((notify) => notify());
}

function NavLink({ item, active, collapsed, label }: { item: NavItem; active: boolean; collapsed: boolean; label: string }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-card px-3 py-2.5 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        active ? "bg-brand-subtle font-semibold text-brand-subtle-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-opacity", active ? "opacity-100" : "opacity-0")}
      />
      <Icon className={cn("size-[18px] shrink-0", active ? "text-brand" : "text-fg-muted group-hover:text-fg")} aria-hidden />
      {!collapsed && <span className="min-w-0 truncate">{label}</span>}
    </Link>
  );
}

/**
 * Role-aware grouped navigation (Learning, Exams, Users, Reports, Settings). The routes come from navForRole,
 * so a role never sees a section item it cannot open. The section holding the current page stays open.
 */
export function SidebarSections({ role, collapsed }: { role: Role; collapsed: boolean }) {
  const t = useTranslations("nav");
  const ts = useTranslations("nav.sections");
  const pathname = usePathname();
  const baseId = React.useId();
  const { top, sections } = React.useMemo(() => groupedNavForRole(role), [role]);
  const foldedRaw = React.useSyncExternalStore(subscribe, readFolded, () => "");
  const folded = React.useMemo(() => new Set(foldedRaw.split(",").filter(Boolean)), [foldedRaw]);

  const toggle = (id: NavSectionId) => {
    const next = new Set(folded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeFolded([...next]);
  };

  return (
    <>
      {top.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} collapsed={collapsed} label={t(item.key)} />
      ))}
      {sections.map((section) => {
        const hasActive = section.items.some((item) => isActive(pathname, item.href));
        const open = hasActive || !folded.has(section.id);
        const panelId = `${baseId}-${section.id}`;
        if (collapsed) {
          return (
            <div key={section.id} role="group" aria-label={ts(section.id)} className="space-y-1 border-t border-border/60 pt-2">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} collapsed label={t(item.key)} />
              ))}
            </div>
          );
        }
        return (
          <div key={section.id} className="pt-2">
            <button
              type="button"
              onClick={() => toggle(section.id)}
              aria-expanded={open}
              aria-controls={panelId}
              data-testid={`nav-section-${section.id}`}
              className={cn(
                "flex min-h-9 w-full items-center justify-between rounded-field px-3 py-1.5 text-overline font-semibold transition-colors",
                hasActive ? "text-brand" : "text-fg-subtle hover:text-fg",
              )}
            >
              <span>{ts(section.id)}</span>
              <ChevronDown className={cn("size-3.5 transition-transform duration-base", !open && "-rotate-90")} aria-hidden />
            </button>
            <div id={panelId} role="group" aria-label={ts(section.id)} hidden={!open} className="mt-0.5 space-y-1">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} collapsed={false} label={t(item.key)} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
