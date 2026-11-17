import { cva, type VariantProps } from "class-variance-authority";

/**
 * Tugma uslublari — oddiy, toza va ishonarli.
 * Neon, glow va soya effektlari olib tashlangan.
 * Mobilda kamida 44px balandlik kafolatlangan.
 */
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap min-h-[44px] transition-[background-color,border-color,color,transform] duration-fast ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Asosiy amal — sahifada bittadan ortiq bo'lmasin */
        primary: "bg-brand text-brand-fg hover:bg-brand-hover",
        /** Ikkilamchi — chegarali, fonsiz */
        outline: "border border-border-strong bg-surface text-fg hover:bg-surface-hover",
        /** Uchinchi darajali — faqat matn */
        ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
        /** Buzuvchi amal (o'chirish) */
        danger: "bg-danger text-danger-fg hover:opacity-90",
        /** Yumshoq brend — fon och yashil */
        subtle: "bg-brand-subtle text-brand-subtle-fg hover:bg-brand/15",
        /** Matnli havola ko'rinishi (jadval va matn ichida) */
        link: "min-h-0 px-0 text-brand underline-offset-4 hover:underline",
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
