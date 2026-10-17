"use client";

import * as React from "react";
import { KeyRound, Play, Radio, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useJoinLiveExamRoom } from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function LiveExamPinCard({ className }: { className?: string }) {
  const router = useRouter();
  const joinMut = useJoinLiveExamRoom();
  const [pin, setPin] = React.useState("");

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlPin = params.get("pin")?.replace(/\D/g, "").slice(0, 6);
    if (urlPin && urlPin.length === 6) {
      setPin(urlPin);
    }
  }, []);

  async function handleJoin(e?: React.FormEvent) {
    e?.preventDefault();
    const cleanPin = pin.replace(/\D/g, "").slice(0, 6);
    if (cleanPin.length !== 6) {
      toast.error("6 xonali imtihon PIN-kodini to'liq kiriting");
      return;
    }

    try {
      const res = await joinMut.mutateAsync({ pin: cleanPin });
      const roomId = res.session?.id ?? "";
      const simMode = res.simulatorMode ?? res.session?.simulatorMode ?? "cdi";

      if (typeof window !== "undefined") {
        try {
          if (res.attemptToken || res.sessionSignature) {
            sessionStorage.setItem(
              `bw_attempt_token_${res.attemptId}`,
              res.attemptToken || res.sessionSignature || "",
            );
          }
          if (roomId) {
            sessionStorage.setItem(`bw_live_room_${res.attemptId}`, roomId);
          }
          sessionStorage.setItem(`bw_simulator_${res.attemptId}`, simMode);
        } catch {
          // ignore storage quota errors
        }
      }

      toast.success("Jonli imtihon xonasiga muvaffaqiyatli ulandingiz!");
      router.push(
        `/mock/attempt/${res.attemptId}?simulator=${encodeURIComponent(simMode)}${
          roomId ? `&room=${encodeURIComponent(roomId)}` : ""
        }`,
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Ushbu PIN-kod bilan faol imtihon xonasi topilmadi",
      );
    }
  }

  return (
    <Card
      className={cn(
        "mb-5 overflow-hidden border-2 border-brand/40 bg-gradient-to-r from-brand/10 via-surface to-surface p-4 sm:p-5 shadow-sm",
        className,
      )}
    >
      <form
        onSubmit={(e) => void handleJoin(e)}
        className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand" className="gap-1">
              <Radio className="size-3 animate-pulse" />
              Live Exam Room (PIN Mode)
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
              <ShieldCheck className="size-3.5" />
              IELTS CDI &amp; Multi-Level DTM Simulyator
            </span>
          </div>
          <h3 className="text-base font-bold text-fg">
            O&apos;qituvchi bergan 6 xonali PIN-kod orqali jonli imtihonga kiring
          </h3>
          <p className="text-xs text-fg-muted">
            Guruh bilan bir vaqtda rasmiy kompyuter imtihonini (CDI yoki DTM rejimida) boshlash uchun kodni kiriting.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center shrink-0">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand" />
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="PIN: 482915"
              aria-label="6 xonali imtihon PIN kodi"
              className="h-11 w-full sm:w-44 pl-9 text-center font-mono text-lg font-black tracking-[0.25em] text-fg border-brand/50"
            />
          </div>
          <Button
            type="submit"
            loading={joinMut.isPending}
            disabled={pin.replace(/\D/g, "").length !== 6}
            className="h-11 bg-brand px-5 font-bold text-brand-fg hover:bg-brand-hover"
          >
            <Play className="size-4 mr-1.5 fill-current" />
            Imtihonga ulanish
          </Button>
        </div>
      </form>
    </Card>
  );
}
