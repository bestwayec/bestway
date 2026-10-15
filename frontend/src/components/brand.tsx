import Image from "next/image";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { WingedEmblem } from "@/components/common/logo";

export { WingedEmblem };

/**
 * Best Way markaz logotipi:
 * 1. `BrandMark` — asl yashil-emerald squircle qanotli vektor SVG (sun rays, wings, B monogram)
 * 2. `BrandImage` — transparent PNG rasmi (fallback/image varianti)
 */
export function BrandMark({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return <WingedEmblem className={className} animated={animated} />;
}

const SIZE = {
  sm: { mark: "size-8", text: "text-base" },
  md: { mark: "size-9", text: "text-lg" },
  lg: { mark: "size-12", text: "text-2xl" },
} as const;

/**
 * Shaffof PNG rasmi (fallback yoki image varianti uchun)
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
 * Emblema + "Best Way" so'z-belgisi. `showText={false}` — faqat qanotli emblema.
 * `variant="mark"` — asl yashil-emerald qanotli squircle vektor SVG.
 */
export function Brand({
  className,
  size = "md",
  showText = true,
  animated = false,
  variant = "mark",
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
            <span className="bg-gradient-to-r from-emerald-400 to-[#89F336] bg-clip-text text-transparent">
              {t("best")}
            </span>
            <span className="text-white ml-0.5">{t("way")}</span>
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
          <span className="bg-gradient-to-r from-emerald-400 to-[#89F336] bg-clip-text text-transparent">
            {t("best")}
          </span>
          <span className="text-white ml-0.5">{t("way")}</span>
        </span>
      )}
    </span>
  );
}

