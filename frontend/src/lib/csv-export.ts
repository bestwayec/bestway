export type CsvCell = string | number | boolean | null | undefined;

/** Excel-readable UTF-8; quoted text cannot become a spreadsheet formula. */
export function encodeCsv(rows: readonly (readonly CsvCell[])[]): string {
  const cell = (value: CsvCell) => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + rows.map(row => row.map(cell).join(";")).join("\r\n") + "\r\n";
}

export function downloadCsv(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  try {
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Allow the browser to start reading the blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }
}
