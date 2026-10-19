"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, KeyRound, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Field, Input } from "@/components/ui/input";
import { authApi, ApiError } from "@/lib/api-client";
import { routing } from "@/i18n/routing";
import { homePathForRole } from "@/lib/role-routing";
import { GoogleAuthButton } from "./google-auth-button";
import { cn } from "@/lib/utils";

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

  const [loginMethod, setLoginMethod] = React.useState<"password" | "otp">("password");
  const [showPass, setShowPass] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isTelegramLoggingIn, setIsTelegramLoggingIn] = React.useState(false);

  // 6-digit OTP states
  const [otpDigits, setOtpDigits] = React.useState<string[]>(["", "", "", "", "", ""]);
  const [isVerifyingOtp, setIsVerifyingOtp] = React.useState(false);
  const otpInputsRef = React.useRef<(HTMLInputElement | null)[]>([]);

  const schema = React.useMemo(() => makeSchema((k) => t(`errors.${k}`)), [t]);
  const defaultPhone = params?.get("id") || params?.get("phone") || params?.get("identifier") || "";
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: defaultPhone,
      password: "",
    },
  });

  React.useEffect(() => {
    const idParam = params?.get("id") || params?.get("phone") || params?.get("identifier");
    if (idParam) {
      setValue("phone", idParam);
    }
  }, [params, setValue]);

  const redirectAfterLogin = React.useCallback(
    (role: string) => {
      const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
      let target = `${prefix}${homePathForRole(role as import("@/lib/types").Role)}`;
      const next = params?.get("next") || params?.get("redirect");
      if (next) {
        const normalized = next.replace(/\\/g, "/");
        if (normalized.startsWith("/") && !normalized.startsWith("//")) {
          const resolved = new URL(normalized, window.location.origin);
          if (resolved.origin === window.location.origin) target = normalized;
        } else if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
          try {
            const resolved = new URL(normalized);
            if (resolved.origin === window.location.origin) {
              target = `${resolved.pathname}${resolved.search}${resolved.hash}`;
            }
          } catch {}
        }
      }
      window.location.assign(target);
    },
    [locale, params],
  );

  // Handle Telegram SSO automatic login if params present (e.g. from bot link or widget redirect)
  React.useEffect(() => {
    const hash = params?.get("hash");
    const sso_token = params?.get("sso_token");
    const tgAuthResult = params?.get("tgAuthResult");

    if (hash || sso_token || tgAuthResult) {
      const payload: Record<string, unknown> = {};
      params.forEach((value, key) => {
        payload[key] = value;
      });

      setIsTelegramLoggingIn(true);
      authApi
        .telegramLogin(payload)
        .then((user) => {
          toast.success(t("welcomeBack"));
          redirectAfterLogin(user.role);
        })
        .catch((err) => {
          setIsTelegramLoggingIn(false);
          const message = (err as any)?.message || (err instanceof Error ? err.message : null) || tc("unknownError");
          setServerError(message);
        });
    }
  }, [params, redirectAfterLogin, t, tc]);

  async function onPasswordSubmit(values: Values) {
    setServerError(null);
    try {
      const user = await authApi.login(values.phone.replace(/\s/g, ""), values.password);
      toast.success(t("welcomeBack"));
      redirectAfterLogin(user.role);
    } catch (err) {
      const message = (err as any)?.message || (err instanceof Error ? err.message : null) || tc("unknownError");
      setServerError(message);
    }
  }

  function handleOtpDigitChange(index: number, val: string) {
    const cleaned = val.replace(/\D/g, "");
    if (!cleaned) {
      setOtpDigits((prev) => {
        const copy = [...prev];
        copy[index] = "";
        return copy;
      });
      return;
    }

    if (cleaned.length > 1) {
      const digits = cleaned.slice(0, 6).split("");
      setOtpDigits((prev) => {
        const copy = [...prev];
        digits.forEach((d, i) => {
          if (index + i < 6) copy[index + i] = d;
        });
        return copy;
      });
      const nextIdx = Math.min(index + digits.length, 5);
      otpInputsRef.current[nextIdx]?.focus();
      return;
    }

    setOtpDigits((prev) => {
      const copy = [...prev];
      copy[index] = cleaned[0];
      return copy;
    });

    if (index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = otpDigits.join("");
    if (code.length !== 6) {
      setServerError(t("otpCodeRequired"));
      return;
    }

    setServerError(null);
    setIsVerifyingOtp(true);
    try {
      const user = await authApi.telegramOtpLogin(code);
      toast.success(t("welcomeBack"));
      redirectAfterLogin(user.role);
    } catch (err) {
      setIsVerifyingOtp(false);
      const message = err instanceof ApiError ? err.message : tc("unknownError");
      setServerError(message);
    }
  }

  function handleTelegramLogin() {
    setServerError(null);
    const tg =
      typeof window !== "undefined"
        ? (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram
        : undefined;
    const initData = tg?.WebApp?.initData;
    if (initData) {
      setIsTelegramLoggingIn(true);
      authApi
        .telegramLogin({ initData })
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

    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "xabar_bestway_bot";
    window.open(`https://t.me/${botUsername}?start=login`, "_blank", "noopener,noreferrer");
  }

  if (isTelegramLoggingIn) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-8">
        <Loader2 className="size-8 animate-spin text-emerald-400" />
        <p className="text-sm font-medium text-slate-200">{t("telegramLoggingIn")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Switcher: Password vs Telegram OTP */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-950/60 p-1 border border-slate-800/80">
        <button
          type="button"
          onClick={() => {
            setLoginMethod("password");
            setServerError(null);
          }}
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold transition-all",
            loginMethod === "password"
              ? "bg-emerald-600 text-white shadow-md"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50",
          )}
        >
          <Smartphone className="size-3.5" />
          {t("passwordTab")}
        </button>
        <button
          type="button"
          onClick={() => {
            setLoginMethod("otp");
            setServerError(null);
          }}
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold transition-all",
            loginMethod === "otp"
              ? "bg-emerald-600 text-white shadow-md"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50",
          )}
        >
          <KeyRound className="size-3.5" />
          {t("telegramOtpTab")}
        </button>
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-xl border border-red-800/60 bg-red-950/40 px-3.5 py-3 text-sm text-red-300"
        >
          {serverError}
        </div>
      )}

      {loginMethod === "password" ? (
        <form onSubmit={handleSubmit(onPasswordSubmit)} className="space-y-4" noValidate>
          <Field label={t("phone")} error={errors.phone?.message} htmlFor="phone">
            <Input
              id="phone"
              type="text"
              autoComplete="username"
              placeholder={t("phonePlaceholder")}
              aria-invalid={!!errors.phone}
              className="bg-slate-950/60 border-slate-700/60 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500 rounded-xl transition-all"
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
                className="pr-10 bg-slate-950/60 border-slate-700/60 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white placeholder-slate-500 rounded-xl transition-all"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-200"
                aria-label={showPass ? "Hide password" : "Show password"}
                title={showPass ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-950/40 transition-all hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("loggingIn")}
              </>
            ) : (
              t("loginButton")
            )}
          </button>
        </form>
      ) : (
        /* Telegram 6-Digit OTP Form */
        <form onSubmit={handleOtpSubmit} className="space-y-4" noValidate>
          <div className="text-center space-y-1">
            <h3 className="text-sm font-semibold text-slate-200">{t("telegramOtpTitle")}</h3>
            <p className="text-xs text-slate-400">{t("telegramOtpHint")}</p>
          </div>

          {/* 6-Digit SMS-style inputs */}
          <div className="flex justify-center items-center gap-2 sm:gap-2.5 py-2">
            {otpDigits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => {
                  otpInputsRef.current[idx] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={digit}
                onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                  if (pasted) {
                    const next = ["", "", "", "", "", ""];
                    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
                    setOtpDigits(next);
                    otpInputsRef.current[Math.min(pasted.length, 5)]?.focus();
                  }
                }}
                className="size-11 sm:size-12 rounded-xl border border-slate-700/60 bg-slate-950/60 text-center text-xl sm:text-2xl font-bold text-white shadow-inner focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none transition-all"
                autoFocus={idx === 0}
              />
            ))}
          </div>

          <button
            type="submit"
            disabled={isVerifyingOtp || otpDigits.join("").length !== 6}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-950/40 transition-all hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-50"
          >
            {isVerifyingOtp ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("verifyingOtp")}
              </>
            ) : (
              t("verifyAndLogin")
            )}
          </button>

          {/* Direct link to Telegram bot to get code */}
          <a
            href="https://t.me/xabar_bestway_bot?start=code"
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#229ED9]/40 bg-[#229ED9]/10 px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#38bdf8] hover:bg-[#229ED9]/20 transition"
          >
            <svg className="size-4 fill-current shrink-0" viewBox="0 0 24 24">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.535-.194 1.006.128.832.957z" />
            </svg>
            {t("getTelegramCode")}
          </a>
        </form>
      )}

      <div className="relative my-4 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-800" />
        </div>
        <div className="relative bg-slate-900 px-3 text-xs uppercase text-slate-400">
          {t("or")}
        </div>
      </div>

      <div className="space-y-3">
        <GoogleAuthButton
          mode="signin"
          onSuccess={(user) => redirectAfterLogin(user.role)}
          onError={(err) => setServerError(err)}
        />

        <button
          type="button"
          onClick={handleTelegramLogin}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-700/80 bg-slate-950/50 px-4 py-2.5 text-sm font-semibold text-slate-200 shadow-sm transition hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
        >
          <svg className="size-5 fill-[#229ED9]" viewBox="0 0 24 24">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.535-.194 1.006.128.832.957z" />
          </svg>
          <span>{t("telegramLogin")}</span>
        </button>
      </div>

      <p className="text-center text-sm text-slate-400 pt-2">
        {t("noAccount")}{" "}
        <Link href="/register" className="font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
          {t("registerButton")}
        </Link>
      </p>
    </div>
  );
}
