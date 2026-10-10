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

function makeSchema(t: (k: string) => string) {
  return z.object({
    phone: z
      .string()
      .min(1, t("phoneRequired"))
      .regex(/^\+?\d[\d\s]{8,14}$/, t("phoneInvalid")),
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

  const schema = React.useMemo(() => makeSchema((k) => t(`errors.${k}`)), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      const user = await authApi.login(values.phone.replace(/\s/g, ""), values.password);
      toast.success(t("welcomeBack"));

      // Cookie'lar o'rnatildi — to'liq yangilanish bilan o'tamiz, shunda
      // middleware yangi rolni ko'radi va app qobig'i SSR'da to'g'ri render bo'ladi.
      const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
      let target = `${prefix}${homePathForRole(user.role)}`;
      const next = params.get("next");
      if (next) {
        const normalized = next.replace(/\\/g, "/");
        if (normalized.startsWith("/") && !normalized.startsWith("//")) {
          const resolved = new URL(normalized, window.location.origin);
          if (resolved.origin === window.location.origin) target = normalized;
        }
      }
      window.location.assign(target);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : tc("unknownError");
      setServerError(message);
    }
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

      <p className="text-center text-sm text-fg-muted">
        {t("noAccount")}{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          {t("registerButton")}
        </Link>
      </p>
    </form>
  );
}
