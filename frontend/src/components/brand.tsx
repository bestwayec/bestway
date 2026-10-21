import Image from "next/image";
import { cn } from "@/lib/utils";
import { WingedEmblem } from "@/components/common/logo";

export { WingedEmblem };

const SIZE = {
  sm: { full: "h-7 sm:h-8", mark: "size-8" },
  md: { full: "h-9 sm:h-10", mark: "size-9" },
  lg: { full: "h-11 sm:h-12", mark: "size-11" },
  xl: { full: "h-14 sm:h-16", mark: "size-14" },
} as const;

/**
 * Markaziy 3D kubik ikonkasi (avatar, kichik nishonlar, collapsed holat)
 */
export function BrandMark({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <Image
      src="/brand/bestway-icon.png"
      alt="Best Way"
      width={48}
      height={48}
      className={cn(
        "object-contain shrink-0 select-none",
        animated && "animate-pulse transition-transform duration-300 hover:scale-105",
        className,
      )}
    />
  );
}

/**
 * Shaffof to'liq qanotli PNG rasmi
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
      src="/brand/bestway-logo-full.png"
      alt="Best Way"
      width={1024}
      height={367}
      priority={priority}
      className={cn("h-auto w-auto object-contain drop-shadow-md select-none", className)}
    />
  );
}

/**
 * Asl Qanotli Best Way Emblemasi.
 * `showText={false}` bo'lganda faqat markaziy 3D kubik nishoni ko'rsatiladi.
 * `showText={true}` bo'lganda to'liq qanotli va yozuvli rasmiy nishon aks etadi.
 */
export function Brand({
  className,
  size = "md",
  showText = true,
  animated = false,
}: {
  className?: string;
  size?: keyof typeof SIZE;
  showText?: boolean;
  animated?: boolean;
  variant?: "image" | "mark";
}) {
  const s = SIZE[size] || SIZE.md;

  if (!showText) {
    return (
      <Image
        src="/brand/bestway-icon.png"
        alt="Best Way"
        width={48}
        height={48}
        priority
        className={cn(
          "object-contain shrink-0 select-none drop-shadow-md transition-transform duration-300 hover:scale-105",
          s.mark,
          animated && "animate-pulse",
          className,
        )}
      />
    );
  }

  return (
    <span className={cn("inline-flex items-center select-none", className)}>
      <Image
        src="/brand/bestway-logo-full.png"
        alt="Best Way"
        width={1024}
        height={367}
        priority
        className={cn(
          "w-auto object-contain drop-shadow-md transition-transform duration-300 hover:scale-[1.02]",
          s.full,
          animated && "animate-pulse",
        )}
      />
    </span>
  );
}
