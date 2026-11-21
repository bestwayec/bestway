"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { ChevronRight, X } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { groupedNavForRole, isActive, navForRole, type NavItem } from "@/lib/nav";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Mobil "More" pastki paneli:
 * Qo'shimcha bo'limlar shu yerda. Soya yo'q, toza 1px chegara.
 */
export function MobileNavMoreSheet({
  role,
  primaryHrefs,
  open,
  onOpenChange,
}: {
  role: Role;
  primaryHrefs: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const ts = useTranslations("nav.sections");
  const overflow = navForRole(role).filter(
    (item) => !primaryHrefs.includes(item.href) && item.key !== "notifications",
  );
  // Staff roles see the same sections as the desktop sidebar; students keep the flat list.
  const hrefs = new Set(overflow.map((item) => item.href));
  const groups: Array<{ id: string | null; items: NavItem[] }> =
    role === "student"
      ? [{ id: null, items: overflow }]
      : [
          { id: null, items: groupedNavForRole(role).top.filter((item) => hrefs.has(item.href)) },
          ...groupedNavForRole(role).sections.map((section) => ({ id: section.id as string | null, items: section.items.filter((item) => hrefs.has(item.href)) })),
        ].filter((group) => group.items.length > 0);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          className="anim-sheet pb-safe fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-card border-t border-border bg-surface"
          aria-label={t("more")}
        >
          <div className="sticky top-0 bg-surface pt-2 pb-1 border-b border-border/40">
            <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-border" />
            <div className="flex items-center justify-between px-4 pt-2">
              <DialogPrimitive.Title className="text-subtitle font-semibold text-fg">
                {t("more")}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                className="inline-flex size-9 items-center justify-center rounded-field text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                aria-label={tc("close")}
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <nav className="space-y-3 p-3">
            {groups.map((group) => (
              <div key={group.id ?? "top"} role={group.id ? "group" : undefined} aria-label={group.id ? ts(group.id) : undefined} className="space-y-1">
                {group.id && <p className="px-3 pt-1 text-overline font-semibold text-fg-subtle">{ts(group.id)}</p>}
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => onOpenChange(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-[44px] items-center gap-3 rounded-card px-3 py-2.5 text-sm font-medium transition-colors",
                        active ? "bg-brand-subtle text-brand-subtle-fg font-semibold" : "text-fg hover:bg-surface-hover",
                      )}
                    >
                      <Icon className="size-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
                      {active && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />}
                      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
