"use client";

import * as React from "react";
import { EyeOff, HelpCircle, RotateCcw, Settings2, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { broadcastVolume, DEFAULT_EXAM_SETTINGS, type ExamColours, type ExamLineSpacing, type ExamSettings, type ExamTextSize, type ExamTheme } from "@/lib/exam-settings";
import { useTheme } from "@/components/theme-provider";
import { resetSplitPreferences } from "./reading-split-divider";

const TEXT_SIZES: ExamTextSize[] = ["regular", "large", "xlarge"];
const COLOURS: ExamColours[] = ["standard", "yellow_on_black", "black_on_cream"];
const LINE_SPACINGS: ExamLineSpacing[] = ["normal", "relaxed"];
const THEMES: ExamTheme[] = ["site", "light", "dark"];

function Toggle({ checked, label, hint, onChange }: { checked: boolean; label: string; hint: string; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-field border border-border bg-surface px-3 py-2">
      <input type="checkbox" className="mt-1 size-4 accent-brand" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-fg">{label}</span>
        <span className="block text-sm text-fg-muted">{hint}</span>
      </span>
    </label>
  );
}
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
            "min-h-[44px] rounded-field border px-3 text-sm font-medium",
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
export type ExamToolbarHandle = { open: (panel: "settings" | "help") => void; hide: () => void };

export const ExamToolbar = React.forwardRef<ExamToolbarHandle, {
  settings: ExamSettings;
  onChange: (next: ExamSettings) => void;
  questionTypes: string[];
  timeLeft: string | null;
  /** Classes for the icon buttons' group (e.g. hidden on phones, where a menu opens the same panels). */
  iconsClassName?: string;
}>(function ExamToolbar({ settings, onChange, questionTypes, timeLeft, iconsClassName }, ref) {
  const t = useTranslations("mock.examTools");
  const [open, setOpen] = React.useState<null | "settings" | "help">(null);
  const [hidden, setHidden] = React.useState(false);
  React.useImperativeHandle(ref, () => ({ open: (panel) => setOpen(panel), hide: () => setHidden(true) }), []);
  const resume = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { if (hidden) resume.current?.focus(); }, [hidden]);
  const { setTheme } = useTheme();
  // Light / dark is the site theme itself, so the whole window (dialogs included) agrees; "site" leaves it alone.
  const chooseTheme = (theme: ExamTheme) => {
    onChange({ ...settings, theme });
    if (theme !== "site") setTheme(theme);
  };
  const restoreDefaults = () => {
    broadcastVolume(DEFAULT_EXAM_SETTINGS.volume);
    resetSplitPreferences();
    onChange(DEFAULT_EXAM_SETTINGS);
  };
  const helpTypes = HELP_TYPES.filter((type) => questionTypes.some((q) => helpTypeOf(q) === type));

  const iconButton = "min-h-[40px] min-w-[40px] px-2";
  return (
    <>
      <div className={cn("flex items-center gap-1", iconsClassName)} role="group" aria-label={t("toolsLabel")}>
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
            <div className="space-y-2">
              <p id="exam-theme-label" className="text-sm font-semibold text-fg">{t("theme")}</p>
              <Choice name="exam-theme" value={settings.theme} options={THEMES} label={(v) => t(`theme_${v}`)} onChange={chooseTheme} />
            </div>
            <div className="space-y-2">
              <p id="exam-line-spacing-label" className="text-sm font-semibold text-fg">{t("lineSpacing")}</p>
              <Choice name="exam-line-spacing" value={settings.lineSpacing} options={LINE_SPACINGS} label={(v) => t(`lineSpacing_${v}`)} onChange={(lineSpacing) => onChange({ ...settings, lineSpacing })} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle checked={settings.reduceMotion} label={t("reduceMotion")} hint={t("reduceMotionHint")} onChange={(reduceMotion) => onChange({ ...settings, reduceMotion })} />
              <Toggle checked={settings.strongFocus} label={t("strongFocus")} hint={t("strongFocusHint")} onChange={(strongFocus) => onChange({ ...settings, strongFocus })} />
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-sm text-fg-muted">{t("restoreHint")}</p>
              <Button type="button" size="sm" variant="outline" onClick={restoreDefaults}>
                <RotateCcw className="mr-1.5 size-4" aria-hidden />{t("restoreDefaults")}
              </Button>
            </div>
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
            <section className="rounded-field bg-bg-subtle p-3 text-sm">
              <h3 className="font-semibold text-fg">{t("helpNavigationTitle")}</h3>
              <p className="mt-1 text-fg-muted">{t("helpNavigation")}</p>
            </section>
            {helpTypes.map((type) => (
              <section key={type} className="rounded-field bg-bg-subtle p-3 text-sm" data-help-type={type}>
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
});
