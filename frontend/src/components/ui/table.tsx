import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Data table (docs/design/DIRECTION.md): a bordered card that scrolls sideways on narrow screens,
 * tabular numbers, a quiet header row and hover on body rows. Numbers align right with `numeric`.
 */
export function Table({ className, wrapperClassName, ...props }: React.ComponentProps<"table"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("scrollbar-thin w-full overflow-x-auto rounded-card border border-border bg-surface", wrapperClassName)}>
      <table className={cn("w-full caption-bottom border-collapse text-sm tabular-nums", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-bg-subtle", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn("border-b border-border transition-colors duration-fast hover:bg-surface-hover/60 data-[state=selected]:bg-brand-subtle", className)}
      {...props}
    />
  );
}

export function TableHead({ className, numeric, ...props }: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-11 whitespace-nowrap border-b border-border px-3 text-left align-middle text-sm font-semibold text-fg-muted first:pl-4 last:pr-4",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, numeric, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn("px-3 py-3 align-middle text-fg first:pl-4 last:pr-4", numeric && "text-right font-medium", className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption className={cn("px-4 py-3 text-left text-sm text-fg-muted", className)} {...props} />;
}
