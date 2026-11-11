"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { isActive, mobileNavForRole, navForRole } from "@/lib/nav";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MobileNavMoreSheet } from "./mobile-nav-more-sheet";

const tabClass = (active: boolean) =>
  cn(
    "relative flex min-w-0 flex-1 min-h-[48px] flex-col items-center justify-center gap-0.5 py-1.5 text-caption font-medium transition-colors touch-manipulation",
    active ? "text-brand font-semibold" : "text-fg-muted hover:text-fg",
  );

/**
 * Mobil pastki navigatsiya:
 * 4 ta asosiy bo'lim + 1 ta "Yana" tugmasi.
 * Tugmalar kamida 44px, matn kamida 14px.
 */
export function MobileNav({ role }: { role: Role }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  const primary = mobileNavForRole(role);
  const primaryHrefs = primary.map((item) => item.href);
  const overflow = navForRole(role).filter((item) => !primaryHrefs.includes(item.href) && item.key !== "notifications");
  const moreActive = overflow.some((item) => isActive(pathname, item.href));

  return (
    <>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface lg:hidden">
        <div className="flex items-stretch justify-around">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={tabClass(active)}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 h-0.5 w-8 rounded-full bg-brand transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon className={cn("size-5 shrink-0", active ? "text-brand" : "text-fg-muted")} />
                <span className="max-w-full truncate px-1 text-[12px] leading-tight min-[380px]:text-[14px]">{t(item.key)}</span>
              </Link>
            );
          })}
          {overflow.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-current={moreActive ? "page" : undefined}
              className={tabClass(moreActive)}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-0 h-0.5 w-8 rounded-full bg-brand transition-opacity",
                  moreActive ? "opacity-100" : "opacity-0",
                )}
              />
              <MoreHorizontal
                className={cn("size-5 shrink-0", moreActive ? "text-brand" : "text-fg-muted")}
              />
              <span className="max-w-full truncate px-1 text-[12px] leading-tight min-[380px]:text-[14px]">{t("more")}</span>
            </button>
          )}
        </div>
      </nav>
      <MobileNavMoreSheet
        role={role}
        primaryHrefs={primaryHrefs}
        open={moreOpen}
        onOpenChange={setMoreOpen}
      />
    </>
  );
}
