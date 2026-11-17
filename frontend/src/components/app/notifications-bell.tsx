"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMe } from "@/hooks/use-me";

export function NotificationsBell() {
  const t = useTranslations("nav");
  const { data } = useMe();
  const count = data?.unreadNotifications ?? 0;

  return (
    <Link
      href="/notifications"
      aria-label={t("notifications")}
      className="relative inline-flex size-8 items-center justify-center rounded-field text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
    >
      <Bell className="size-[18px]" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white tabular-nums">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
