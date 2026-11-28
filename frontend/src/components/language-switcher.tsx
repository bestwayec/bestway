"use client";

import { useLocale } from "next-intl";
import * as React from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPathname, usePathname } from "@/i18n/navigation";
import { locales, localeNames, type Locale } from "@/i18n/routing";

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const [isPending, setPending] = React.useState(false);
  // Controlled + non-modal: a modal menu locks <body> (overflow hidden +
  // padding-right compensation). If locale navigation unmounts the tree while
  // it is open, that cleanup never runs — scrollbar vanishes (~15px right gap,
  // content shifts) and the stuck overlay eats clicks. Non-modal never locks.
  const [open, setOpen] = React.useState(false);

  function switchTo(next: Locale) {
    // Same locale — no navigation (avoids a pointless reload).
    if (next === locale) return;
    setOpen(false);
    setPending(true);
    // A real page load of the explicitly prefixed URL (also /uz for the default language): the server records
    // the choice in the locale cookie and serves the page in that language. A client transition kept the old
    // page's links on screen; their prefetches (/en/...) re-wrote the old locale cookie, so the next click
    // went back to English. Language changes are rare, so a reload is acceptable.
    const target = getPathname({ href: pathname, locale: next, forcePrefix: true });
    window.location.assign(`${target}${window.location.search}${window.location.hash}`);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={isPending} className="gap-1.5 px-2">
          <Globe className="size-4" />
          <span className="text-xs font-semibold uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((code) => (
          <DropdownMenuCheckboxItem
            key={code}
            checked={code === locale}
            onCheckedChange={() => switchTo(code)}
          >
            {localeNames[code]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
