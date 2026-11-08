"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { BookA, ChevronDown, Compass, LogOut, Swords, Trophy, User } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/feedback";
import { useMe } from "@/hooks/use-me";
import { authApi } from "@/lib/api-client";
import { routing } from "@/i18n/routing";
import { formatPhone } from "@/lib/utils";

export function UserMenu() {
  const t = useTranslations("common");
  const tn = useTranslations("nav");
  const tr = useTranslations("roles");
  const locale = useLocale();
  const qc = useQueryClient();
  const { data, isLoading } = useMe();
  const [loggingOut, setLoggingOut] = React.useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    let confirmed = false;
    try {
      await authApi.logout();
      confirmed = true;
    } catch {
      // Local cookies may be gone even if server-side revocation failed.
    } finally {
      qc.clear();
      const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
      window.location.replace(`${prefix}/login${confirmed ? "" : "?logout_unconfirmed=1"}`);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="hidden h-4 w-24 sm:block" />
      </div>
    );
  }

  const { user } = data;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-[10px] p-1 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand/20">
        <Avatar name={user.name} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block max-w-32 truncate text-sm font-medium text-fg">{user.name}</span>
          <span className="block text-xs text-fg-muted">{tr(user.role)}</span>
        </span>
        <ChevronDown className="hidden size-4 text-fg-subtle sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" collisionPadding={12} className="w-[calc(100vw-2rem)] max-w-64 sm:min-w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-fg">{user.name}</span>
          <span className="text-xs font-normal text-fg-muted">{formatPhone(user.phone)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User className="size-4" />
            {t("profile")}
          </Link>
        </DropdownMenuItem>

        {user.role === "student" && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/exam-track">
                <Compass className="size-4" />
                {tn("examTrack")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/leaderboard">
                <Trophy className="size-4" />
                {tn("leaderboard")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/vocabulary">
                <BookA className="size-4" />
                {tn("vocabulary")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/bamboozle">
                <Swords className="size-4" />
                {tn("bamboozle")}
              </Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={loggingOut} onSelect={handleLogout}>
          <LogOut className="size-4" />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
