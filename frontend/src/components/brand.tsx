// eslint-disable @typescript-eslint/no-require-imports
"use client";

import Image from "next/image";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * Best Way markaz logotipi — 2 variant:
 * 1. `BrandMark` — yangi vektor SVG (yashil squircle, minimal)
 * 2. `BrandImage` — eski kub + qanotlar + quyosh logotipi (foydalanuvchi so'rovi asosida)
 *    Yangi shaffof PNG `public/logo-transparent.png` (2130×762, 3× upscale, fon olib tashlangan)
 *    har qanday fonda (yorug'/qorong'i) mukammal ko'rinadi.
 */
export function BrandMark({
  className,
  animated = false,
}: {
  className?: string;
  /** Quyosh pulsatsiya qiladi, qanotlar yengil "qoqadi" (hero/kirish uchun) */
  animated?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-hidden
      className={cn("bw-mark shrink-0", animated && "bw-mark-animated", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="bwlogo_tile" x1="6" y1="3" x2="42" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#89F336" />
          <stop offset="0.58" stopColor="#FFED29" />
          <stop offset="1" stopColor="#FF991C" />
        </linearGradient>
        <radialGradient id="bwlogo_sun" cx="0.5" cy="0.38" r="0.75">
          <stop stopColor="#fffbd1" />
          <stop offset="0.5" stopColor="#FFED29" />
          <stop offset="1" stopColor="#FF991C" />
        </radialGradient>
      </defs>

      <rect x="1.5" y="1.5" width="45" height="45" rx="13" fill="url(#bwlogo_tile)" />
      <path
        d="M14.5 1.5H33.5C40.4 1.5 46.5 7.6 46.5 14.5V17.5C46.5 10.6 40.4 5 33.5 5H14.5C7.6 5 1.5 11.6 1.5 18.5V14.5C1.5 7.6 7.6 1.5 14.5 1.5Z"
        fill="#ffffff"
        opacity="0.20"
      />

      <g className="bw-mark-sun">
        <circle cx="24" cy="15" r="6.2" fill="url(#bwlogo_sun)" />
        <g stroke="#FFED29" strokeWidth="1.7" strokeLinecap="round">
          <line x1="24" y1="5.2" x2="24" y2="7.4" />
          <line x1="14.9" y1="7.9" x2="16.5" y2="9.6" />
          <line x1="33.1" y1="7.9" x2="31.5" y2="9.6" />
        </g>
      </g>

      <path
        className="bw-mark-wing"
        fill="#ffffff"
        opacity="0.96"
        d="M4.5 23C12 28 18 31 24 31.3C30 31 36 28 43.5 23C41 25.6 38.4 27.5 35.4 29C31.4 31.1 27.6 32.4 24 33.7C20.4 32.4 16.6 31.1 12.6 29C9.6 27.5 7 25.6 4.5 23Z"
      />

      <path
        fill="#ffffff"
        fillRule="evenodd"
        d="M18 12.4H26.5C30.1 12.4 32.4 14.6 32.4 17.8C32.4 19.9 31.3 21.5 29.5 22.3C31.9 23 33.4 24.9 33.4 27.7C33.4 31.2 30.7 33.6 26.7 33.6H18V12.4ZM22.3 16V20.6H25.9C27.4 20.6 28.1 19.7 28.1 18.3C28.1 17 27.4 16 25.9 16H22.3ZM22.3 24V30H26.2C27.8 30 28.7 28.8 28.7 27C28.7 25.2 27.8 24 26.2 24H22.3Z"
      />
    </svg>
  );
}

const SIZE = {
  sm: { mark: "size-8", text: "text-base" },
  md: { mark: "size-9", text: "text-lg" },
  lg: { mark: "size-12", text: "text-2xl" },
} as const;

/**
 * Eski kub + qanotlar logotipi — foydalanuvchi taqdim etgan rasm asosida.
 * Shaffof PNG `public/logo.png` (2130×762) va `public/logo-transparent.png`
 * har qanday fonda mukammal ko'rinadi (fon olib tashlangan, 3× upscale).
 */
export function BrandImage({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt="Best Way"
      width={2130}
      height={762}
      priority={priority}
      className={cn("h-auto w-auto object-contain drop-shadow-sm", className)}
    />
  );
}

/**
 * Emblema + "Best Way" so'z-belgisi. `showText={false}` — faqat emblema.
 * `variant="image"` — eski kub logotipi (shaffof PNG), `variant="mark"` — yangi SVG.
 */
export function Brand({
  className,
  size = "md",
  showText = true,
  animated = false,
  variant = "image",
}: {
  className?: string;
  size?: keyof typeof SIZE;
  showText?: boolean;
  animated?: boolean;
  variant?: "image" | "mark";
}) {
  const t = useTranslations("brand");
  const s = SIZE[size];
  if (variant === "image") {
    return (
      <span className={cn("inline-flex items-center gap-2.5", className)}>
        <BrandImage
          priority
          className={cn(
            size === "sm" ? "h-8" : size === "lg" ? "h-12" : "h-10",
            "w-auto",
          )}
        />
        {showText && (
          <span className={cn("font-extrabold leading-none tracking-tight", s.text)}>
            <span className="bg-gradient-to-br from-brand to-accent bg-clip-text text-transparent">
              {t("best")}
            </span>
            <span className="text-fg">{t("way")}</span>
          </span>
        )}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className={cn(s.mark, "drop-shadow-sm")} animated={animated} />
      {showText && (
        <span className={cn("font-extrabold leading-none tracking-tight", s.text)}>
          <span className="bg-gradient-to-br from-brand to-accent bg-clip-text text-transparent">
            {t("best")}
          </span>
          <span className="text-fg">{t("way")}</span>
        </span>
      )}
    </span>
  );
}
