import { cva, type VariantProps } from "class-variance-authority";

/**
 * Tugma uslublari — oddiy, toza va ishonarli.
 * Neon, glow va soya effektlari olib tashlangan.
 * Mobilda kamida 44px balandlik kafolatlangan.
 */
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 rounded-[12px] font-semibold whitespace-nowrap min-h-[44px] transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Asosiy amal — sahifada bittadan ortiq bo'lmasin */
        primary: "bg-brand text-brand-fg hover:bg-brand-hover",
        /** Ikkilamchi — chegarali, fonsiz */
        outline: "border border-border bg-transparent text-fg hover:bg-surface-hover hover:border-border-strong",
        /** Uchinchi darajali — faqat matn */
        ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
        /** Buzuvchi amal (o'chirish) */
        danger: "bg-danger text-white hover:opacity-90",
        /** Yumshoq brend — fon och yashil */
        subtle: "bg-brand-subtle text-brand-subtle-fg hover:opacity-80",
      },
      size: {
        sm: "h-11 px-3 text-sm [&_svg]:size-4",
        md: "h-11 px-4 text-sm [&_svg]:size-4",
        lg: "h-12 px-6 text-base [&_svg]:size-5",
        icon: "size-11 [&_svg]:size-4",
        "icon-sm": "size-11 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
