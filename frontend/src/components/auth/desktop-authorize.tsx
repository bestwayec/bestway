"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, Copy, Loader2, MonitorSmartphone } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Card } from "@/components/ui/card";
import { SpecularButton } from "@/components/ui/specular-button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";

/** Desktop ilova tanigan qaytish manzillari */
const ALLOWED_CALLBACKS = [
  "bestway-exam://auth/callback",
  "bestway://auth/callback",
] as const;
const DEFAULT_DESKTOP_CALLBACK = "bestway-exam://auth/callback";

type Phase =
  | { name: "invalid" }
  | { name: "ready" }
  | { name: "authorizing" }
  | { name: "done"; code: string; callbackUrl: string }
  | { name: "error"; message: string }
  | { name: "needLogin" };

interface AuthorizeResponse {
  code: string;
  state: string;
  expiresAt: string;
}

export function DesktopAuthorize() {
  const t = useTranslations("desktopAuth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const params = useSearchParams();
  const [phase, setPhase] = React.useState<Phase>({ name: "ready" });
  const [copied, setCopied] = React.useState(false);
  const [copiedUrl, setCopiedUrl] = React.useState(false);
  // Default to true for 1-click single-action authorization.
  const [agreed, setAgreed] = React.useState(true);
  const autoSubmittedRef = React.useRef(false);
  // The border-beam animation pauses for reduced-motion users.
  const [reducedMotion, setReducedMotion] = React.useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const device = params.get("device") ?? "";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const rawRedirect = params.get("redirect") ?? "";
  const redirect = rawRedirect || DEFAULT_DESKTOP_CALLBACK;
  const isRedirectAllowed = (ALLOWED_CALLBACKS as readonly string[]).includes(redirect);
  const paramsValid =
    device.length >= 8 &&
    state.length >= 16 &&
    /^[A-Za-z0-9_-]{43}$/.test(codeChallenge) &&
    isRedirectAllowed;

  // Invalid params -> "invalid" phase. Derived during render (not in an effect)
  // so no cascading render: the adjustment commits before paint.
  const paramsInvalid = !paramsValid;
  const [prevParamsInvalid, setPrevParamsInvalid] = React.useState(paramsInvalid);
  if (prevParamsInvalid !== paramsInvalid) {
    setPrevParamsInvalid(paramsInvalid);
    if (paramsInvalid) setPhase({ name: "invalid" });
  }

  const loginNext = React.useMemo(() => {
    const search = params.toString();
    const full = search ? `${pathname}?${search}` : pathname;
    return encodeURIComponent(full);
  }, [pathname, params]);

  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  const authorize = React.useCallback(async () => {
    setPhase({ name: "authorizing" });
    setCopied(false);
    setCopiedUrl(false);
    try {
      const data = await api.post<AuthorizeResponse>("/auth/desktop/authorize", {
        deviceId: device,
        state,
        codeChallenge,
        redirect,
      });
      const callbackUrl = `${redirect}?code=${encodeURIComponent(data.code)}&state=${encodeURIComponent(data.state)}`;
      setPhase({ name: "done", code: data.code, callbackUrl });
      // Deep-link ilovani ochishga harakat qiladi; ishlamasa — qo'lda kod.
      window.location.assign(callbackUrl);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === "SESSION_EXPIRED")) {
        setPhase({ name: "needLogin" });
        return;
      }
      setPhase({
        name: "error",
        message: err instanceof ApiError ? err.message : tc("unknownError"),
      });
    }
  }, [codeChallenge, device, redirect, state, tc]);

  // If the user is logged in, automatically submit authorization on mount
  React.useEffect(() => {
    if (paramsValid && !autoSubmittedRef.current && phase.name === "ready") {
      autoSubmittedRef.current = true;
      void authorize();
    }
  }, [authorize, paramsValid, phase.name]);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function copyCallbackUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
    } catch {
      setCopiedUrl(false);
    }
  }

  return (
    <Card className="elevated-lg border-border/70 bg-surface/95 p-6 backdrop-blur-sm sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <MonitorSmartphone className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-fg">{t("title")}</h1>
      </div>

      {phase.name === "invalid" && (
        <p role="alert" className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger">
          {t("invalidParams")}
        </p>
      )}

      {phase.name === "needLogin" && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-fg-muted">{t("needLogin")}</p>
          <Link
            href={`/login?next=${loginNext}`}
            className="inline-flex w-full items-center justify-center rounded-[12px] bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
          >
            {t("loginButton")}
          </Link>
        </div>
      )}

      {phase.name === "ready" && (
        <div className="space-y-4">
          <p className="flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-black/20 px-3 py-1 font-mono text-xs text-fg-muted">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
              {t("deviceLabel")} · {device.slice(0, 8)}…
            </span>
          </p>
          <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-border/70 bg-black/20 px-3.5 py-3 text-left transition hover:border-brand/40 has-checked:border-brand/60 has-checked:bg-brand/5">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border border-border bg-white/5 text-transparent transition peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface"
            >
              <Check className="size-3.5" aria-hidden="true" />
            </span>
            <span className="text-sm text-fg-muted">{t("consentCheck")}</span>
          </label>
          <SpecularButton
            type="button"
            size="lg"
            radius={12}
            tint="#89F336"
            tintOpacity={1}
            textColor="#101704"
            lineColor="#FFED29"
            baseColor="#4E9F1E"
            intensity={1.15}
            shineSize={10}
            shineFade={40}
            thickness={1.5}
            speed={0.55}
            autoAnimate={!reducedMotion}
            disabled={!agreed}
            onClick={authorize}
            className="w-full"
          >
            {t("authorizeButton")}
          </SpecularButton>
        </div>
      )}

      {phase.name === "authorizing" && (
        <p className="flex items-center justify-center gap-2 text-sm text-fg-muted" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t("authorizing")}
        </p>
      )}

      {phase.name === "error" && (
        <div className="space-y-4">
          <p role="alert" className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger">
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => setPhase({ name: "ready" })}
            className="w-full rounded-[12px] border border-border px-4 py-2.5 text-sm font-medium text-fg hover:bg-surface"
          >
            {t("retryButton")}
          </button>
        </div>
      )}

      {phase.name === "done" && (
        <div className="space-y-4">
          <p className="text-center text-sm font-medium text-emerald-600">{t("successTitle")}</p>
          <p className="text-center text-xs text-fg-muted">{t("successHint")}</p>
          <Field label={t("codeLabel")} htmlFor="desktop-code">
            <div className="flex gap-2">
              <Input id="desktop-code" readOnly value={phase.code} className="font-mono" onFocus={(e) => e.target.select()} />
              <button
                type="button"
                onClick={() => copyCode(phase.code)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-border px-3 text-sm text-fg hover:bg-surface"
              >
                {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                {copied ? t("copied") : t("copyButton")}
              </button>
            </div>
          </Field>
          <Field label={t("callbackLabel")} htmlFor="desktop-callback-url">
            <div className="flex gap-2">
              <Input
                id="desktop-callback-url"
                readOnly
                value={phase.callbackUrl}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={() => copyCallbackUrl(phase.callbackUrl)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-border px-3 text-sm text-fg hover:bg-surface"
              >
                {copiedUrl ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                {copiedUrl ? t("copied") : t("copyButton")}
              </button>
            </div>
          </Field>
          <a
            href={phase.callbackUrl}
            className="inline-flex w-full items-center justify-center rounded-[12px] bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
          >
            {t("openAppButton")}
          </a>
          <p className="text-center text-[11px] text-fg-subtle">
            <Link href={`${prefix}/dashboard`} className="hover:underline">
              {t("backToDashboard")}
            </Link>
          </p>
        </div>
      )}
    </Card>
  );
}
