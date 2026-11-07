"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { ChevronRight, X } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { isActive, navForRole } from "@/lib/nav";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Mobil "More" pastki paneli — pastki menyuga sig'magan barcha rolga mos
 * bo'limlar shu yerda (100% nav reachability). Tanlash yoki backdrop tap
 * bilan yopiladi. z-50: topbar (z-20) va pastki nav (z-30) dan yuqorida.
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
  const overflow = navForRole(role).filter((item) => !primaryHrefs.includes(item.href));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="anim-sheet pb-safe fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-[16px] border-t border-border bg-surface shadow-lg"
          aria-label={t("more")}
        >
          <div className="sticky top-0 bg-surface pt-2 pb-1">
            <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-border" />
            <div className="flex items-center justify-between px-4 pt-2">
              <DialogPrimitive.Title className="text-base font-semibold text-fg">
                {t("more")}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                className="rounded-[6px] p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                aria-label={tc("close")}
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <nav className="px-2 pt-1 pb-4">
            {overflow.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => onOpenChange(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "bg-brand-subtle text-brand-subtle-fg" : "text-fg hover:bg-surface-hover",
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
                  {active && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />}
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                </Link>
              );
            })}
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
