"use client";

import * as React from "react";
import { KeyRound, Play, Radio, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useJoinLiveExamRoom } from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function LiveExamPinCard({ className }: { className?: string }) {
  const tp = useTranslations("mock.livePin");
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
      toast.error(tp("pinIncomplete"));
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

      toast.success(tp("joined"));
      router.push(
        `/mock/attempt/${res.attemptId}?simulator=${encodeURIComponent(simMode)}${
          roomId ? `&room=${encodeURIComponent(roomId)}` : ""
        }`,
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : tp("notFound"),
      );
    }
  }

  return (
    <Card
      className={cn(
        "rounded-[12px] border border-border bg-surface p-5",
        className,
      )}
    >
      <form
        onSubmit={(e) => void handleJoin(e)}
        className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5 text-sm">
              <Radio className="size-3.5 text-brand" />
              {tp("badge")}
            </Badge>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-fg-muted">
              <ShieldCheck className="size-4 text-brand" />
              CDI / Multi-Level
            </span>
          </div>
          <h3 className="text-base font-semibold text-fg">
            {tp("title")}
          </h3>
          <p className="text-sm text-fg-muted">
            {tp("description")}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center shrink-0">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={tp("placeholder")}
              aria-label={tp("inputLabel")}
              className="min-h-[44px] w-full sm:w-44 pl-9 text-center font-mono text-lg font-bold tracking-[0.2em] text-fg border-border"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            loading={joinMut.isPending}
            disabled={pin.replace(/\D/g, "").length !== 6}
            className="min-h-[44px] px-5 font-medium"
          >
            <Play className="size-4 mr-1.5" />
            {tp("join")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
