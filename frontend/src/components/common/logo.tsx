"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  animated?: boolean;
  variant?: "vector" | "image";
}

const SIZES = {
  xs: { mark: "size-6", full: "h-6" },
  sm: { mark: "size-8", full: "h-8" },
  md: { mark: "size-10", full: "h-10" },
  lg: { mark: "size-12", full: "h-12" },
  xl: { mark: "size-16", full: "h-16" },
} as const;

/**
 * Authentic Winged BestWay Emblem Icon (central cube)
 */
export function WingedEmblem({
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
        "object-contain shrink-0 select-none drop-shadow-sm",
        animated && "animate-pulse transition-transform duration-300 hover:scale-105",
        className,
      )}
    />
  );
}

/**
 * Universal BestWay Logo Component
 * Renders the authentic winged emblem or central icon.
 */
export function Logo({
  className,
  size = "md",
  showText = true,
  animated = false,
}: LogoProps) {
  const s = SIZES[size] || SIZES.md;

  if (!showText) {
    return (
      <Image
        src="/brand/bestway-icon.png"
        alt="BestWay"
        width={48}
        height={48}
        priority
        className={cn(
          "object-contain shrink-0 select-none drop-shadow-sm transition-transform duration-300 hover:scale-105",
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
        alt="BestWay"
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
