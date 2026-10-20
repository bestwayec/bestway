"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocale, useTranslations } from "next-intl";
import { Eye, EyeOff, GraduationCap, Users } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authApi, ApiError } from "@/lib/api-client";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { GoogleAuthButton } from "./google-auth-button";

function makeSchema(t: (k: string) => string) {
  return z.object({
    name: z.string().min(2, t("nameShort")),
    phone: z
      .string()
      .min(1, t("phoneRequired"))
      .regex(/^\+?\d[\d\s]{8,14}$/, t("phoneInvalid")),
    password: z.string().min(6, t("passwordShort")),
    role: z.enum(["student", "parent"]),
  });
}

type Values = z.infer<ReturnType<typeof makeSchema>>;

export function RegisterForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [showPass, setShowPass] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const schema = React.useMemo(() => makeSchema((k) => t(`errors.${k}`)), [t]);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: "student" },
  });

  const role = watch("role");

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      await authApi.register({
        name: values.name.trim(),
        phone: values.phone.replace(/\s/g, ""),
        password: values.password,
        role: values.role,
      });
      toast.success(t("welcomeBack"));
      const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
      window.location.assign(`${prefix}/dashboard`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : tc("unknownError");
      setServerError(message);
    }
  }

  function handleTelegramLogin() {
    setServerError(null);
    const tg = typeof window !== "undefined" ? (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram : undefined;
    const initData = tg?.WebApp?.initData;
    if (initData) {
      authApi.telegramLogin({ initData })
        .then(() => {
          toast.success(t("welcomeBack"));
          const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
          window.location.assign(`${prefix}/dashboard`);
        })
        .catch((err) => {
          const message = err instanceof ApiError ? err.message : tc("unknownError");
          setServerError(message);
        });
      return;
    }

    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "xabar_bestway_bot";
    window.open(`https://t.me/${botUsername}?start=login`, "_blank", "noopener,noreferrer");
  }

  const roles = [
    { value: "student" as const, label: t("asStudent"), Icon: GraduationCap },
    { value: "parent" as const, label: t("asParent"), Icon: Users },
  ];

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

      {/* Rol tanlash — o'quvchi yoki ota-ona */}
      <Field label={t("iam")}>
        <div className="grid grid-cols-2 gap-2">
          {roles.map(({ value, label, Icon }) => {
            const active = role === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setValue("role", value, { shouldValidate: true })}
                aria-pressed={active}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-[8px] border px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t("fullName")} error={errors.name?.message} htmlFor="name">
        <Input
          id="name"
          autoComplete="name"
          placeholder={t("namePlaceholder")}
          aria-invalid={!!errors.name}
          {...register("name")}
        />
      </Field>

      <Field label={t("phone")} error={errors.phone?.message} htmlFor="phone">
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
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
            autoComplete="new-password"
            placeholder={t("passwordPlaceholder")}
            aria-invalid={!!errors.password}
            className="pr-10"
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPass((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-fg-subtle hover:text-fg"
            tabIndex={-1}
            aria-label={showPass ? tc("close") : tc("edit")}
          >
            {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        {t("registerButton")}
      </Button>

      <div className="relative my-3 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative bg-surface px-3 text-xs uppercase text-fg-muted">
          {t("or")}
        </div>
      </div>

      <div className="space-y-2.5">
        <GoogleAuthButton
          mode="signup"
          role={role}
          onSuccess={(user) => {
            const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
            window.location.assign(`${prefix}/dashboard`);
          }}
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

      <p className="rounded-[8px] bg-bg-subtle px-3 py-2 text-center text-xs text-fg-muted">
        {t("staffNotice")}
      </p>

      <p className="text-center text-sm text-fg-muted">
        {t("haveAccount")}{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          {t("loginButton")}
        </Link>
      </p>
    </form>
  );
}
