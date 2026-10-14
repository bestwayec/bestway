"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { SpecularButton } from "@/components/ui/specular-button";
import { Field, Input } from "@/components/ui/input";
import { authApi, ApiError } from "@/lib/api-client";
import { routing } from "@/i18n/routing";
import { homePathForRole } from "@/lib/role-routing";

const LOGIN_IDENTIFIER_RE =
  /^(?:\+?\d[\d\s]{8,14}|[^\s@]+@[^\s@]+\.[^\s@]+|[a-zA-Z0-9_.-]{3,64})$/;

function makeSchema(t: (k: string) => string) {
  return z.object({
    phone: z
      .string()
      .trim()
      .min(1, t("phoneRequired"))
      .regex(LOGIN_IDENTIFIER_RE, t("phoneInvalid")),
    password: z.string().min(1, t("passwordRequired")),
  });
}

type Values = z.infer<ReturnType<typeof makeSchema>>;

export function LoginForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const params = useSearchParams();
  const [showPass, setShowPass] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isTelegramLoggingIn, setIsTelegramLoggingIn] = React.useState(false);

  const schema = React.useMemo(() => makeSchema((k) => t(`errors.${k}`)), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const redirectAfterLogin = React.useCallback((role: string) => {
    const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
    let target = `${prefix}${homePathForRole(role as import("@/lib/types").Role)}`;
    const next = params.get("next");
    if (next) {
      const normalized = next.replace(/\\/g, "/");
      if (normalized.startsWith("/") && !normalized.startsWith("//")) {
        const resolved = new URL(normalized, window.location.origin);
        if (resolved.origin === window.location.origin) target = normalized;
      }
    }
    window.location.assign(target);
  }, [locale, params]);

  // Handle Telegram SSO automatic login if params present (e.g. from bot link or widget redirect)
  React.useEffect(() => {
    const hash = params.get("hash");
    const sso_token = params.get("sso_token");
    const tgAuthResult = params.get("tgAuthResult");

    if (hash || sso_token || tgAuthResult) {
      const payload: Record<string, unknown> = {};
      params.forEach((value, key) => {
        payload[key] = value;
      });

      setIsTelegramLoggingIn(true);
      authApi.telegramLogin(payload)
        .then((user) => {
          toast.success(t("welcomeBack"));
          redirectAfterLogin(user.role);
        })
        .catch((err) => {
          setIsTelegramLoggingIn(false);
          const message = err instanceof ApiError ? err.message : tc("unknownError");
          setServerError(message);
        });
    }
  }, [params, redirectAfterLogin, t, tc]);

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      const user = await authApi.login(values.phone.replace(/\s/g, ""), values.password);
      toast.success(t("welcomeBack"));
      redirectAfterLogin(user.role);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : tc("unknownError");
      setServerError(message);
    }
  }

  function handleTelegramLogin() {
    setServerError(null);
    // Check if running inside Telegram WebApp
    const tg = typeof window !== "undefined" ? (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram : undefined;
    const initData = tg?.WebApp?.initData;
    if (initData) {
      setIsTelegramLoggingIn(true);
      authApi.telegramLogin({ initData })
        .then((user) => {
          toast.success(t("welcomeBack"));
          redirectAfterLogin(user.role);
        })
        .catch((err) => {
          setIsTelegramLoggingIn(false);
          const message = err instanceof ApiError ? err.message : tc("unknownError");
          setServerError(message);
        });
      return;
    }

    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "bestwayec_bot";
    window.open(`https://t.me/${botUsername}?start=login`, "_blank", "noopener,noreferrer");
  }

  if (isTelegramLoggingIn) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-8">
        <Loader2 className="size-8 animate-spin text-brand" />
        <p className="text-sm font-medium text-fg">{t("telegramLoggingIn")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {serverError && (
        <div
          role="alert"
          className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger"
        >
          {serverError}
        </div>
      )}

      <Field label={t("phone")} error={errors.phone?.message} htmlFor="phone">
        <Input
          id="phone"
          type="text"
          autoComplete="username"
          placeholder={t("phonePlaceholder")}
          aria-invalid={!!errors.phone}
          {...register("phone")}
        />
      </Field>

      <Field label={t("password")} error={errors.password?.message} htmlFor="password">
        <div className="relative">
          <Input
            id="password"
            type={showPass ? "text" : "password"}
            autoComplete="current-password"
            placeholder={t("passwordPlaceholder")}
            aria-invalid={!!errors.password}
            className="pr-10"
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPass((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-fg-subtle hover:text-fg"
            aria-label={showPass ? "Hide password" : "Show password"}
            title={showPass ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <SpecularButton
        type="submit"
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
        disabled={isSubmitting}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t("loggingIn")}
          </>
        ) : (
          t("loginButton")
        )}
      </SpecularButton>

      <div className="relative my-3 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative bg-surface px-3 text-xs uppercase text-fg-muted">
          {t("or")}
        </div>
      </div>

      <button
        type="button"
        onClick={handleTelegramLogin}
        className="flex w-full items-center justify-center gap-2.5 rounded-[12px] bg-[#229ED9] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1E88E5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229ED9]"
      >
        <svg className="size-5 fill-current" viewBox="0 0 24 24">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.535-.194 1.006.128.832.957z" />
        </svg>
        {t("telegramLogin")}
      </button>

      <p className="text-center text-sm text-fg-muted pt-2">
        {t("noAccount")}{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          {t("registerButton")}
        </Link>
      </p>
    </form>
  );
}
