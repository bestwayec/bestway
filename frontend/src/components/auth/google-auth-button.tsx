"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authApi, ApiError } from "@/lib/api-client";
import type { PublicUser } from "@/lib/types";

export const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "502060795540-ve4stfeb6un42b0dfh1snr0978294aat.apps.googleusercontent.com";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            context?: string;
          }) => void;
          prompt: (momentListener?: (notification: unknown) => void) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
  }
}

interface GoogleAuthButtonProps {
  mode?: "signin" | "signup";
  role?: "student" | "parent";
  onSuccess: (user: PublicUser) => void;
  onError?: (error: string) => void;
  className?: string;
}

export function GoogleAuthButton({
  mode = "signin",
  role = "student",
  onSuccess,
  onError,
  className = "",
}: GoogleAuthButtonProps) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [isLoading, setIsLoading] = React.useState(false);
  const hiddenBtnRef = React.useRef<HTMLDivElement>(null);

  const handleCredentialResponse = React.useCallback(
    async (response: { credential: string }) => {
      if (!response.credential) return;
      setIsLoading(true);
      try {
        const user = await authApi.googleAuth(response.credential, role);
        toast.success(t("welcomeBack"));
        onSuccess(user);
      } catch (err) {
        setIsLoading(false);
        const message =
          err instanceof ApiError ? err.message : tc("unknownError");
        onError?.(message);
        toast.error(message);
      }
    },
    [onSuccess, onError, role, t, tc],
  );

  React.useEffect(() => {
    let isMounted = true;

    function initGsi() {
      if (!window.google?.accounts?.id) return;
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
          context: mode === "signup" ? "signup" : "signin",
        });

        // Render official GSI button in the overlay container
        if (hiddenBtnRef.current) {
          hiddenBtnRef.current.innerHTML = "";
          window.google.accounts.id.renderButton(hiddenBtnRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: mode === "signup" ? "signup_with" : "signin_with",
            shape: "rectangular",
            logo_alignment: "left",
            width: 380,
          });
        }

        // Trigger Google One Tap for instant single-click sign-in/sign-up
        window.google.accounts.id.prompt();
      } catch (e) {
        if (isMounted) {
          console.warn("Google Identity Services initialization:", e);
        }
      }
    }

    if (window.google?.accounts?.id) {
      initGsi();
    } else {
      const existingScript = document.getElementById("google-gsi-client");
      if (!existingScript) {
        const script = document.createElement("script");
        script.id = "google-gsi-client";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => {
          if (isMounted) initGsi();
        };
        document.head.appendChild(script);
      } else {
        existingScript.addEventListener("load", () => {
          if (isMounted) initGsi();
        });
      }
    }

    return () => {
      isMounted = false;
    };
  }, [handleCredentialResponse, mode]);

  const buttonText = mode === "signup" ? t("googleSignUp") : t("googleLogin");

  return (
    <div className="relative w-full">
      <button
        type="button"
        disabled={isLoading}
        className={`relative flex w-full items-center justify-center gap-3 rounded-[12px] border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-fg shadow-sm transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-70 ${className}`}
      >
        {isLoading ? (
          <>
            <Loader2 className="size-5 animate-spin text-fg-subtle" />
            <span>{t("googleLoggingIn")}</span>
          </>
        ) : (
          <>
            <svg className="size-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>{buttonText}</span>
          </>
        )}
      </button>

      {/* Transparent overlay containing official GSI rendered button for seamless native popup on click */}
      <div
        ref={hiddenBtnRef}
        aria-hidden="true"
        className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden opacity-0"
        style={{ pointerEvents: isLoading ? "none" : "auto" }}
      />
    </div>
  );
}
