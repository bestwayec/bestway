"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          // text-base (16px) mobilda — iOS fokusda avtomatik zoom qilmasligi uchun;
          // sm dan boshlab 14px (zich formalar chiroyliroq ko'rinadi)
          "h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-fg sm:text-sm",
          "placeholder:text-fg-subtle",
          "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-20 w-full rounded-control border border-input-border bg-surface px-3 py-2 text-base text-fg sm:text-sm",
          "placeholder:text-fg-subtle",
          "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-[invalid=true]:border-danger",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(function Label({ className, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn("text-sm font-medium text-fg", className)}
      {...props}
    />
  );
});

/** Label + input + xatolik matnini bir joyda ushlab turadi */
export function Field({
  label,
  error,
  hint,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = !error && hint && htmlFor ? `${htmlFor}-hint` : undefined;
  const describedBy = errorId ?? hintId;
  const enhancedChildren = describedBy
    ? React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          const existing = (child.props as Record<string, unknown>)['aria-describedby'] as string | undefined;
          const merged = existing ? `${existing} ${describedBy}` : describedBy;
          return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
            'aria-describedby': merged,
            'aria-invalid': error ? true : (child.props as Record<string, unknown>)['aria-invalid'],
          });
        }
        return child;
      })
    : children;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {enhancedChildren}
      {error ? (
        <p id={errorId} className="text-sm text-danger" role={error ? 'alert' : undefined}>
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
