"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn("scrollbar-thin flex items-center gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] max-sm:gap-0.5 [&::-webkit-scrollbar]:hidden", className)}
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
        "relative -mb-px shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-fg-muted transition-colors",
        "hover:text-fg",
        "data-[state=active]:border-brand data-[state=active]:text-fg",
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
