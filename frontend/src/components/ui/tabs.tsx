"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    /** "underline" (default): page sections. "segmented": a compact switch between 2–4 views. */
    variant?: "underline" | "segmented";
  }
>(function TabsList({ className, variant = "underline", ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      data-variant={variant}
      className={cn(
        "group/tabs scrollbar-thin flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        variant === "segmented"
          ? "inline-flex max-w-full gap-1 rounded-control border border-border bg-bg-subtle p-1"
          : "gap-1 border-b border-border max-sm:gap-0.5",
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    /** false when the tabs switch the page below without a TabsContent panel: no aria-controls to a missing id. */
    panel?: boolean;
  }
>(function TabsTrigger({ className, panel = true, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}

      className={cn(
        "relative shrink-0 whitespace-nowrap text-sm font-medium text-fg-muted transition-colors duration-fast hover:text-fg",
        "group-data-[variant=underline]/tabs:-mb-px group-data-[variant=underline]/tabs:min-h-11 group-data-[variant=underline]/tabs:border-b-2 group-data-[variant=underline]/tabs:border-transparent group-data-[variant=underline]/tabs:px-3 group-data-[variant=underline]/tabs:py-2",
        "group-data-[variant=underline]/tabs:data-[state=active]:border-brand group-data-[variant=underline]/tabs:data-[state=active]:text-fg",
        "group-data-[variant=segmented]/tabs:min-h-9 group-data-[variant=segmented]/tabs:rounded-field group-data-[variant=segmented]/tabs:px-3 group-data-[variant=segmented]/tabs:py-1.5",
        "group-data-[variant=segmented]/tabs:data-[state=active]:bg-surface group-data-[variant=segmented]/tabs:data-[state=active]:text-fg group-data-[variant=segmented]/tabs:data-[state=active]:shadow-e1",
        className,
      )}
      {...props}
      {...(panel ? {} : { "aria-controls": undefined })}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn("pt-4", className)} {...props} />;
});
