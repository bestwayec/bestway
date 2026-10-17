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
  xs: { mark: "size-6", text: "text-sm", imgH: "h-6" },
  sm: { mark: "size-8", text: "text-base", imgH: "h-8" },
  md: { mark: "size-10", text: "text-lg", imgH: "h-10" },
  lg: { mark: "size-12", text: "text-2xl", imgH: "h-12" },
  xl: { mark: "size-16", text: "text-3xl", imgH: "h-16" },
} as const;

/**
 * Authentic Winged BestWay Emblem SVG
 * Green-emerald gradient rounded squircle with rising sun rays,
 * soaring flight wings, and letter B monogram.
 */
export function WingedEmblem({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="BestWay"
      className={cn(
        "shrink-0 select-none",
        animated && "animate-pulse transition-transform duration-300 hover:scale-105",
        className,
      )}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="bw_grad_emerald" x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="55%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="bw_wing_glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#E2E8F0" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="bw_sun_shine" cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="45%" stopColor="#FEF08A" />
          <stop offset="100%" stopColor="#F59E0B" />
        </radialGradient>
        <filter id="bw_shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#047857" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Main squircle badge */}
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="12"
        fill="url(#bw_grad_emerald)"
        filter="url(#bw_shadow)"
      />

      {/* Glossy top bevel */}
      <path
        d="M13.5 2H34.5C41.4 2 46 6.6 46 13.5V17C46 10.1 40.5 5 34.5 5H13.5C7.5 5 2 10.1 2 17V13.5C2 6.6 6.6 2 13.5 2Z"
        fill="#FFFFFF"
        opacity="0.25"
      />

      {/* Sun and rays */}
      <circle cx="24" cy="14" r="5.5" fill="url(#bw_sun_shine)" />
      <g stroke="#FEF08A" strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
        <line x1="24" y1="5" x2="24" y2="7" />
        <line x1="15.5" y1="7.5" x2="17" y2="9" />
        <line x1="32.5" y1="7.5" x2="31" y2="9" />
      </g>

      {/* Soaring Flight Wings */}
      <path
        fill="url(#bw_wing_glow)"
        d="M5 21.5C12.5 26.5 18.5 29.5 24 29.8C29.5 29.5 35.5 26.5 43 21.5C40.5 24.2 37.8 26.2 34.8 27.7C30.8 29.8 27.2 31.1 24 32.4C20.8 31.1 17.2 29.8 13.2 27.7C10.2 26.2 7.5 24.2 5 21.5Z"
        opacity="0.96"
      />

      {/* Modern Monogram B */}
      <path
        fill="#FFFFFF"
        fillRule="evenodd"
        d="M18.5 12H26C29.6 12 32 14.2 32 17.3C32 19.3 30.9 20.8 29.2 21.6C31.5 22.3 33 24.2 33 26.9C33 30.3 30.4 32.6 26.4 32.6H18.5V12ZM22.5 15.5V19.8H25.6C27 19.8 27.7 19 27.7 17.7C27.7 16.4 27 15.5 25.6 15.5H22.5ZM22.5 23.2V29H25.9C27.4 29 28.3 27.9 28.3 26.1C28.3 24.4 27.4 23.2 25.9 23.2H22.5Z"
      />
    </svg>
  );
}

/**
 * Universal BestWay Logo Component
 * Renders the crisp vector winged emblem + gradient brand typography.
 */
export function Logo({
  className,
  size = "md",
  showText = true,
  animated = false,
  variant = "vector",
}: LogoProps) {
  const s = SIZES[size] || SIZES.md;
  const [imgError, setImgError] = React.useState(false);

  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      {variant === "image" && !imgError ? (
        <Image
          src="/logo.png"
          alt="BestWay"
          width={2130}
          height={762}
          priority
          onError={() => setImgError(true)}
          className={cn("w-auto object-contain drop-shadow-sm", s.imgH)}
        />
      ) : (
        <WingedEmblem className={cn(s.mark, "drop-shadow-md")} animated={animated} />
      )}

      {showText && (
        <span className={cn("font-black tracking-tight leading-none flex items-center", s.text)}>
          <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent font-extrabold">
            Best
          </span>
          <span className="text-white ml-0.5">Way</span>
        </span>
      )}
    </span>
  );
}

export const BrandLogo = Logo;
export default Logo;
