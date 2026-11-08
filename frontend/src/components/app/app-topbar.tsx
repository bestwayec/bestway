"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationsBell } from "./notifications-bell";
import { UserMenu } from "./user-menu";
import { navForRole, isActive } from "@/lib/nav";
import type { Role } from "@/lib/types";

export function AppTopbar({ role }: { role: Role }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const current = navForRole(role).find((i) => isActive(pathname, i.href));

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="lg:hidden" aria-label="BESTWAY EC">
          <Brand showText={false} />
        </Link>
        <h1 className="hidden truncate text-base font-semibold text-fg lg:block">
          {current ? t(current.key) : ""}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 sm:flex">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
        <NotificationsBell />
        <UserMenu />
      </div>
    </header>
  );
}
