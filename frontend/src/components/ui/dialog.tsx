"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** The close button's name from the catalogue; "Close" where a test renders a dialog without next-intl. */
function useCloseLabel(): string {
  try {
    return useTranslations("common")("close");
  } catch {
    return "Close";
  }
}

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean;
    /**
     * Full-viewport presentation. When enabled, the centered-modal geometry
     * and size constraints are omitted entirely (not overridden) so no
     * default max-height or centering transform can win in the cascade.
     * Uses opacity-only enter/exit animation since the centered dialog
     * keyframes carry a translate(-50%,-50%) offset.
     */
    fullscreen?: boolean;
  }
>(function DialogContent({ className, children, hideClose, fullscreen, ...props }, ref) {
  const closeLabel = useCloseLabel();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-black/45" />
      <DialogPrimitive.Content
        ref={ref}
        className={
          fullscreen
            ? cn(
                "anim-fade fixed inset-0 left-0 top-0 z-50 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0",
                "overflow-hidden rounded-none border-0 bg-bg text-fg",
                "supports-[height:100dvh]:h-[100dvh]",
                className,
              )
            : cn(
                "anim-dialog fixed left-1/2 top-1/2 z-50 max-h-[min(92dvh,720px)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
                "overflow-y-auto overscroll-contain rounded-dialog border border-border bg-surface shadow-e3",
                "max-sm:max-h-[92dvh]",
                className,
              )
        }
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 px-5 pt-5 pb-2", className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 py-2", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 px-5 pb-5 pt-4 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("pr-10 text-lg font-semibold text-fg", className)}
      {...props}
    />
  );
});

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-fg-muted", className)}
      {...props}
    />
  );
});
