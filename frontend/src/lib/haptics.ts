/** Light tap feedback for touch devices. Silently does nothing where unsupported. */
export function haptic(ms = 12): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    /* vibration is best-effort */
  }
}

const TAPPABLE = 'button, [role="button"], [role="radio"], [role="option"], [role="tab"], label, input[type="radio"], input[type="checkbox"], a[href]';

/** One delegated listener gives every button and answer option a 12ms tap. */
export function installHaptics(root: Document = document): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    const target = event.target as Element | null;
    const el = target?.closest?.(TAPPABLE);
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
    haptic(12);
  };
  root.addEventListener("pointerdown", onPointerDown, { passive: true });
  return () => root.removeEventListener("pointerdown", onPointerDown);
}
