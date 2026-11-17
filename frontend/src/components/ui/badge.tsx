import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap [&_svg]:size-3.5",
  {
    variants: {
      size: {
        sm: "px-2 py-px text-sm leading-5",
        md: "px-2.5 py-0.5 text-sm",
      },
      variant: {
        neutral: "bg-bg-subtle text-fg-muted border border-border",
        outline: "bg-transparent text-fg-muted border border-border",
        brand: "bg-brand-subtle text-brand-subtle-fg border border-brand/30",
        success: "bg-success-bg text-success border border-success-border",
        danger: "bg-danger-bg text-danger border border-danger-border",
        warning: "bg-warning-bg text-warning border border-warning-border",
        info: "bg-info-bg text-info border border-info-border",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
