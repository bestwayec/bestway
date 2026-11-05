"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LogOut, User } from "lucide-react";
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
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-[8px] p-1 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand/20">
        <Avatar name={user.name} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block max-w-32 truncate text-sm font-medium text-fg">{user.name}</span>
          <span className="block text-xs text-fg-muted">{tr(user.role)}</span>
        </span>
        <ChevronDown className="hidden size-4 text-fg-subtle sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" collisionPadding={12} className="w-[calc(100vw-2rem)] max-w-56 sm:min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-fg">{user.name}</span>
          <span className="text-xs font-normal text-fg-muted">{formatPhone(user.phone)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User />
            {t("profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem destructive disabled={loggingOut} onSelect={handleLogout}>
          <LogOut />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
