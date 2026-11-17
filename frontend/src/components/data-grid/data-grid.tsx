"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataGridColumn {
  id: string;
  header: React.ReactNode;
  /** Ustun eni (px) */
  width?: number;
  headerClassName?: string;
  /** Bugungi kun / joriy oy kabi ustunni ajratib ko'rsatish */
  highlight?: boolean;
}

export interface DataGridRow {
  id: string;
  /** Chapdagi yopishqoq katak (masalan o'quvchi ismi) */
  header: React.ReactNode;
}

interface DataGridProps {
  columns: DataGridColumn[];
  rows: DataGridRow[];
  renderCell: (rowId: string, colId: string) => React.ReactNode;
  /** Chap-yuqori burchak sarlavhasi */
  corner?: React.ReactNode;
  firstColWidth?: number;
  className?: string;
}

/**
 * Excel-simon jadval: birinchi ustun va sarlavha yopishib turadi,
 * ko'p ustun bo'lsa gorizontal aylanadi, strelkalar bilan kataklar orasida yuriladi.
 * Katak ichidagi tugma `data-grid-cell` bilan belgilansa, klaviatura navigatsiyasi ishlaydi.
 */
export const DataGrid = React.memo(function DataGrid({
  columns,
  rows,
  renderCell,
  corner,
  firstColWidth = 200,
  className,
}: DataGridProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const focusCell = React.useCallback(
    (r: number, c: number) => {
      const root = scrollRef.current;
      if (!root) return;
      const td = root.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);
      const target = td?.querySelector<HTMLElement>("[data-grid-cell]") ?? td;
      target?.focus();
    },
    [],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!keys.includes(e.key)) return;
      const active = document.activeElement as HTMLElement | null;
      const td = active?.closest<HTMLElement>("td[data-r]");
      if (!td) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      let nr = r;
      let nc = c;
      if (e.key === "ArrowUp") nr = Math.max(0, r - 1);
      else if (e.key === "ArrowDown") nr = Math.min(rows.length - 1, r + 1);
      else if (e.key === "ArrowLeft") nc = Math.max(0, c - 1);
      else if (e.key === "ArrowRight") nc = Math.min(columns.length - 1, c + 1);
      if (nr !== r || nc !== c) {
        e.preventDefault();
        focusCell(nr, nc);
      }
    },
    [rows.length, columns.length, focusCell],
  );

  return (
    <div
      ref={scrollRef}
      onKeyDown={onKeyDown}
      className={cn(
        "scrollbar-thin overscroll-x-contain overflow-x-auto rounded-card border border-border bg-surface",
        className,
      )}
    >
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky-col top-0 z-30 border-r border-b border-border bg-bg-subtle px-2 py-2.5 text-left text-xs font-semibold text-fg-muted sm:px-3"
              style={{ minWidth: `clamp(120px, 42vw, ${firstColWidth}px)`, width: `clamp(120px, 42vw, ${firstColWidth}px)` }}
            >
              {corner}
            </th>
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className={cn(
                  "sticky top-0 z-20 border-b border-border bg-bg-subtle px-2 py-2.5 text-center text-xs font-semibold whitespace-nowrap",
                  col.highlight ? "text-brand" : "text-fg-muted",
                  col.headerClassName,
                )}
                style={col.width ? { minWidth: col.width, width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.id} className="group">
              <th
                scope="row"
                className="sticky-col z-10 border-r border-b border-border bg-surface px-2 py-2 text-left font-medium text-fg group-hover:bg-surface-hover sm:px-3"
                style={{ minWidth: `clamp(120px, 42vw, ${firstColWidth}px)`, width: `clamp(120px, 42vw, ${firstColWidth}px)` }}
              >
                {row.header}
              </th>
              {columns.map((col, c) => (
                <td
                  key={col.id}
                  data-r={r}
                  data-c={c}
                  className={cn(
                    "border-b border-border p-0 text-center",
                    col.highlight && "bg-brand-subtle/20",
                  )}
                >
                  {renderCell(row.id, col.id)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
