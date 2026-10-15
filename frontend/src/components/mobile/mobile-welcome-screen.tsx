"use client";

import * as React from "react";
import { Award, Headphones, BookOpen, PenTool, Mic, Send, LogIn, UserPlus, Globe, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { toast } from "sonner";
import { CENTER } from "@/lib/config";
import type { PublicUser } from "@/lib/types";

export function MobileWelcomeScreen({ locale }: { locale: string }) {
  const router = useRouter();
  const pathname = usePathname();

  function onAuthSuccess(user: PublicUser) {
    toast.success(`Xush kelibsiz, ${user.name}!`);
    window.location.assign(`/${locale}/dashboard`);
  }

  function switchLocale(nextLocale: "uz" | "en") {
    if (nextLocale === locale) return;
    router.replace(pathname, { locale: nextLocale });
  }

  const features = [
    { icon: Headphones, title: "Listening CBT", desc: "45 daqiqa · Rasmiy audio" },
    { icon: BookOpen, title: "Reading CBT", desc: "60 daqiqa · 35 ta savol" },
    { icon: PenTool, title: "Writing CBT", desc: "60 daqiqa · Jonli hisoblagich" },
    { icon: Mic, title: "Speaking CBT", desc: "15 daqiqa · AI tahlili" },
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col justify-between bg-gradient-to-b from-[#0B0F17] via-[#0D1520] to-[#0B0F17] px-5 py-6 text-fg">
      {/* Top Bar with Language Switcher */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-emerald-400 font-bold text-bg shadow-[0_0_20px_rgba(16,185,129,0.35)]">
            BW
          </div>
          <span className="text-base font-bold tracking-tight text-fg">BestWay CBT</span>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border/60 bg-surface/80 p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={() => switchLocale("uz")}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              locale === "uz" ? "bg-brand text-bg shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            UZ
          </button>
          <button
            type="button"
            onClick={() => switchLocale("en")}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              locale === "en" ? "bg-brand text-bg shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Hero Visual & Brand */}
      <div className="my-auto py-6 text-center">
        <div className="relative mx-auto mb-5 grid size-24 place-items-center rounded-3xl border border-brand/30 bg-gradient-to-br from-brand/20 to-brand/5 p-4 shadow-[0_0_40px_rgba(16,185,129,0.25)]">
          <Award className="size-12 text-brand animate-pulse" />
          <div className="absolute -bottom-2 -right-2 rounded-full border border-brand/40 bg-brand px-2 py-0.5 text-[10px] font-bold text-bg shadow">
            CBT
          </div>
        </div>

        <h1 className="text-2xl font-extrabold tracking-tight text-fg sm:text-3xl">
          {CENTER.name}
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-fg-muted sm:text-sm">
          IELTS & Multi-Level CEFR rasmiy kompyuter simulyatsiyasi va AI baholash tizimi
        </p>

        {/* 4 Feature Badges */}
        <div className="mt-6 grid grid-cols-2 gap-2 text-left">
          {features.map((feat, idx) => {
            const Icon = feat.icon;
            return (
              <div
                key={idx}
                className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-surface/60 p-2.5 backdrop-blur-md"
              >
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-subtle text-brand">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-fg">{feat.title}</p>
                  <p className="truncate text-[10px] text-fg-muted">{feat.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons Section */}
      <div className="space-y-3 pt-4">
        {/* 1-Tap Google Sign-In */}
        <div className="w-full">
          <GoogleAuthButton
            mode="signin"
            role="student"
            onSuccess={onAuthSuccess}
            className="w-full justify-center"
          />
        </div>

        {/* 1-Tap Telegram SSO */}
        <Button
          asChild
          variant="outline"
          className="w-full justify-center gap-2 border-[#24A1DE]/40 bg-[#24A1DE]/10 py-5 text-[#24A1DE] hover:bg-[#24A1DE]/20 active:scale-[0.98]"
        >
          <a href="https://t.me/xabar_bestway_bot?start=login" target="_blank" rel="noopener noreferrer">
            <Send className="size-4" />
            <span className="font-semibold text-sm">Telegram orqali kirish</span>
          </a>
        </Button>

        {/* Phone / Password Login */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            asChild
            variant="outline"
            className="w-full justify-center gap-1.5 border-border py-4.5 text-xs font-medium text-fg hover:bg-surface-hover active:scale-[0.98]"
          >
            <Link href="/login">
              <LogIn className="size-3.5 text-brand" />
              <span>Kirish</span>
            </Link>
          </Button>

          <Button
            asChild
            className="w-full justify-center gap-1.5 bg-brand py-4.5 text-xs font-semibold text-bg hover:bg-brand-hover active:scale-[0.98]"
          >
            <Link href="/register">
              <UserPlus className="size-3.5" />
              <span>Ro&apos;yxatdan o&apos;tish</span>
            </Link>
          </Button>
        </div>

        {/* Footer info */}
        <div className="pt-2 text-center text-[11px] text-fg-subtle">
          <span>BestWay v0.5.4 · Rasmiy mobil ilova</span>
        </div>
      </div>
    </div>
  );
}
