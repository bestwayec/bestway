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
    "relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-all duration-200 touch-manipulation active:scale-95",
    active ? "text-brand font-semibold" : "text-fg-muted hover:text-fg",
  );

/**
 * Mobil pastki navigatsiya — aniq 5 slot: 4 birlamchi + 1 "More".
 * "More" ichida primary'ga kirmagan BARCHA rolga mos bo'limlar (100% reachability).
 * Desktop yon panel (lg+) o'zgarishsiz qoladi.
 */
export function MobileNav({ role }: { role: Role }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  const primary = mobileNavForRole(role);
  const primaryHrefs = primary.map((item) => item.href);
  const overflow = navForRole(role).filter((item) => !primaryHrefs.includes(item.href));
  const moreActive = overflow.some((item) => isActive(pathname, item.href));

  return (
    <>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-surface/95 backdrop-blur-xl shadow-lg lg:hidden">
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
                {/* yuqoridagi faol chizig'i */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 h-0.5 w-8 rounded-full bg-brand transition-all duration-300",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full px-3 py-0.5 transition-all duration-200",
                    active ? "bg-brand-subtle" : "bg-transparent",
                  )}
                >
                  <Icon className={cn("size-5 transition-transform duration-200", active && "scale-110")} />
                </span>
                <span className="max-w-full truncate px-1">{t(item.key)}</span>
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
                  "absolute top-0 h-0.5 w-8 rounded-full bg-brand transition-all duration-300",
                  moreActive ? "opacity-100" : "opacity-0",
                )}
              />
              <span
                className={cn(
                  "inline-flex items-center justify-center rounded-full px-3 py-0.5 transition-all duration-200",
                  moreActive ? "bg-brand-subtle" : "bg-transparent",
                )}
              >
                <MoreHorizontal
                  className={cn("size-5 transition-transform duration-200", moreActive && "scale-110")}
                />
              </span>
              <span className="max-w-full truncate px-1">{t("more")}</span>
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
