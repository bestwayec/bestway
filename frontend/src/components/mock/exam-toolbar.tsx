"use client";

import * as React from "react";
import { EyeOff, HelpCircle, Settings2, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { broadcastVolume, type ExamColours, type ExamSettings, type ExamTextSize } from "@/lib/exam-settings";

const TEXT_SIZES: ExamTextSize[] = ["regular", "large", "xlarge"];
const COLOURS: ExamColours[] = ["standard", "yellow_on_black", "black_on_cream"];
/** Question types with a help entry, in the order they are listed. */
export const HELP_TYPES = [
  "multiple_choice", "multi_select", "true_false_notgiven", "yes_no_notgiven", "matching", "matching_headings",
  "completion", "map_labelling", "essay", "speaking_task",
] as const;
const COMPLETION = new Set(["sentence_completion", "note_completion", "summary_completion", "table_completion", "short_answer"]);
export function helpTypeOf(type: string): (typeof HELP_TYPES)[number] | null {
  if (COMPLETION.has(type)) return "completion";
  if (type === "essay_task1" || type === "essay_task2") return "essay";
  return (HELP_TYPES as readonly string[]).includes(type) ? (type as (typeof HELP_TYPES)[number]) : null;
}

function Choice<T extends string>({ name, value, options, label, onChange }: { name: string; value: T; options: T[]; label: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-labelledby={`${name}-label`} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "min-h-[44px] rounded-[8px] border px-3 text-sm font-medium",
            value === option ? "border-brand bg-brand-subtle text-brand-subtle-fg" : "border-border bg-surface text-fg hover:bg-surface-hover",
          )}
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

/**
 * Settings, Help and Hide for the exam window (as in IELTS on computer). Hide covers the
 * questions but never stops the clock; the remaining time stays visible.
 */
export function ExamToolbar({
  settings,
  onChange,
  questionTypes,
  timeLeft,
}: {
  settings: ExamSettings;
  onChange: (next: ExamSettings) => void;
  questionTypes: string[];
  timeLeft: string | null;
}) {
  const t = useTranslations("mock.examTools");
  const [open, setOpen] = React.useState<null | "settings" | "help">(null);
  const [hidden, setHidden] = React.useState(false);
  const resume = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { if (hidden) resume.current?.focus(); }, [hidden]);
  const helpTypes = HELP_TYPES.filter((type) => questionTypes.some((q) => helpTypeOf(q) === type));

  const iconButton = "min-h-[44px] min-w-[44px] px-2.5";
  return (
    <>
      <div className="flex items-center gap-1" role="group" aria-label={t("toolsLabel")}>
        <Button size="sm" variant="ghost" className={iconButton} onClick={() => setOpen("settings")} aria-label={t("settings")} title={t("settings")}>
          <Settings2 className="size-4" aria-hidden />
        </Button>
        <Button size="sm" variant="ghost" className={iconButton} onClick={() => setOpen("help")} aria-label={t("help")} title={t("help")}>
          <HelpCircle className="size-4" aria-hidden />
        </Button>
        <Button size="sm" variant="ghost" className={iconButton} onClick={() => setHidden(true)} aria-label={t("hide")} title={t("hide")}>
          <EyeOff className="size-4" aria-hidden />
        </Button>
      </div>

      <Dialog open={open === "settings"} onOpenChange={(value) => setOpen(value ? "settings" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings")}</DialogTitle>
            <DialogDescription>{t("settingsNote")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            <div className="space-y-2">
              <p id="exam-text-size-label" className="text-sm font-semibold text-fg">{t("textSize")}</p>
              <Choice name="exam-text-size" value={settings.textSize} options={TEXT_SIZES} label={(v) => t(`textSize_${v}`)} onChange={(textSize) => onChange({ ...settings, textSize })} />
            </div>
            <div className="space-y-2">
              <p id="exam-colours-label" className="text-sm font-semibold text-fg">{t("colours")}</p>
              <Choice name="exam-colours" value={settings.colours} options={COLOURS} label={(v) => t(`colours_${v}`)} onChange={(colours) => onChange({ ...settings, colours })} />
            </div>
            <label className="block space-y-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg"><Volume2 className="size-4" aria-hidden />{t("volume")}</span>
              <input
                type="range" min={0} max={1} step={0.05} value={settings.volume}
                aria-valuetext={`${Math.round(settings.volume * 100)}%`}
                className="h-6 w-full accent-brand"
                onChange={(event) => { const volume = Number(event.target.value); broadcastVolume(volume); onChange({ ...settings, volume }); }}
              />
            </label>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "help"} onOpenChange={(value) => setOpen(value ? "help" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("help")}</DialogTitle>
            <DialogDescription>{t("helpIntro")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[60vh] space-y-3 overflow-y-auto">
            <section className="rounded-[8px] bg-bg-subtle p-3 text-sm">
              <h3 className="font-semibold text-fg">{t("helpNavigationTitle")}</h3>
              <p className="mt-1 text-fg-muted">{t("helpNavigation")}</p>
            </section>
            {helpTypes.map((type) => (
              <section key={type} className="rounded-[8px] bg-bg-subtle p-3 text-sm" data-help-type={type}>
                <h3 className="font-semibold text-fg">{t(`helpTitle_${type}`)}</h3>
                <p className="mt-1 text-fg-muted">{t(`help_${type}`)}</p>
              </section>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {hidden && (
        <div role="dialog" aria-modal="true" aria-labelledby="exam-hidden-title" className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-bg p-6 text-center" data-testid="exam-hidden">
          <EyeOff className="size-8 text-fg-muted" aria-hidden />
          <h2 id="exam-hidden-title" className="text-lg font-semibold text-fg">{t("hiddenTitle")}</h2>
          <p className="max-w-sm text-sm text-fg-muted">{t("hiddenNote")}</p>
          {timeLeft && <p className="font-mono text-lg font-semibold tabular-nums text-fg" aria-live="off">{t("hiddenTime", { time: timeLeft })}</p>}
          <Button ref={resume} size="lg" onClick={() => setHidden(false)}>{t("resume")}</Button>
        </div>
      )}
    </>
  );
}
