"use client";

import * as React from "react";
import {
  CheckCircle2,
  Download,
  FileDown,
  Laptop,
  Loader2,
  Monitor,
  PlusSquare,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const REPO = "bestwayec/bw-tauri";
// Always the latest published release: no version is written into the page, so it never goes stale.
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
// The APK keeps one file name across releases, so GitHub's "latest" download link always works.
const LATEST_ANDROID_APK_URL = `${RELEASES_URL}/download/bestway-app.apk`;

type Os = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

interface ReleaseAsset {
  name: string;
  url: string;
  sizeMB: string;
}

interface ReleaseInfo {
  version: string;
  publishedAt: string;
  windows: ReleaseAsset[];
  macos: ReleaseAsset[];
  linux: ReleaseAsset[];
  android: ReleaseAsset[];
}

function detectOs(): Os {
  if (typeof navigator === "undefined") return "unknown";
  const uaData = navigator as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean };
  };
  const platform = uaData.userAgentData?.platform?.toLowerCase() ?? "";
  const ua = navigator.userAgent.toLowerCase();

  if (/android/.test(ua) || platform === "android") return "android";
  if (
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  if (/win/.test(platform) || /win/.test(ua)) return "windows";
  if (/mac/.test(platform) || /mac/.test(ua)) return "macos";
  if (/linux|chromeos|ubuntu/.test(platform) || /linux|x11/.test(ua)) return "linux";
  return "unknown";
}

function pickAssets(names: { name: string; url: string; size: number }[]): {
  windows: ReleaseAsset[];
  macos: ReleaseAsset[];
  linux: ReleaseAsset[];
  android: ReleaseAsset[];
} {
  const fmt = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;
  const lower = (n: string) => n.toLowerCase();

  // Windows
  const windowsSeen = new Set<string>();
  const windows: ReleaseAsset[] = [];
  const rawWindows = names
    .filter((a) => /\.exe$|\.msi$/i.test(a.name) && !/0\.5\.[0-7]/i.test(a.name))
    .sort((a, b) => Number(/setup/i.test(b.name)) - Number(/setup/i.test(a.name)));
  for (const a of rawWindows) {
    if (!windowsSeen.has(a.name)) {
      windowsSeen.add(a.name);
      windows.push({ name: a.name, url: a.url, sizeMB: fmt(a.size) });
    }
  }

  // macOS
  const macos = names
    .filter((a) => /\.dmg$/i.test(a.name))
    .map((a) => {
      const n = lower(a.name);
      const arch =
        /arm64|aarch64/.test(n) ? "Apple Silicon" : /x64|intel/.test(n) ? "Intel" : null;
      return { name: arch ? `${a.name} · ${arch}` : a.name, url: a.url, sizeMB: fmt(a.size) };
    });

  // Linux
  const linux = names
    .filter((a) => /\.appimage$|\.deb$/i.test(a.name))
    .sort((a, b) => Number(/\.deb$/i.test(a.name)) - Number(/\.deb$/i.test(b.name)))
    .map((a) => ({ name: a.name, url: a.url, sizeMB: fmt(a.size) }));

  // Android
  const android = names
    .filter((a) => /\.apk$/i.test(a.name))
    .map((a) => ({ name: a.name, url: a.url, sizeMB: fmt(a.size) }));

  return { windows, macos, linux, android };
}

const OS_META: Record<
  Exclude<Os, "unknown">,
  { icon: typeof Monitor; label: string; badge: string }
> = {
  windows: { icon: Monitor, label: "Windows", badge: "Windows 10/11" },
  macos: { icon: Laptop, label: "macOS", badge: "macOS 12+" },
  linux: { icon: Terminal, label: "Linux", badge: "Debian / Ubuntu / Any" },
  android: { icon: Smartphone, label: "Android", badge: "Android 7.0+" },
  ios: { icon: Smartphone, label: "iOS (Apple)", badge: "iPhone & iPad" },
};

export function DesktopDownload() {
  const t = useTranslations("marketing");
  const td = useTranslations("marketing.download");
  const [os] = React.useState<Os>(() => detectOs());
  // Nothing is shown as "the release" until GitHub answers: no stale version or size in the page.
  const [release, setRelease] = React.useState<ReleaseInfo | null>(null);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  function applyRelease(json: {
    tag_name: string;
    published_at: string;
    assets: { name: string; browser_download_url: string; size: number }[];
  }) {
    const picked = pickAssets(
      (json.assets ?? []).map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
      })),
    );
    setRelease({
      version: String(json.tag_name ?? "").replace(/^bestway-app-v|^v?/, "v"),
      publishedAt: json.published_at || "",
      ...picked,
    });
    setError(false);
    setLoading(false);
  }

  function failRelease() {
    setRelease(null);
    setError(true);
    setLoading(false);
  }

  function requestRelease() {
    return fetch(API_URL, { headers: { Accept: "application/vnd.github+json" } }).then(
      async (res) => {
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        return (await res.json()) as {
          tag_name: string;
          published_at: string;
          assets: { name: string; browser_download_url: string; size: number }[];
        };
      },
    );
  }

  React.useEffect(() => {
    let live = true;
    requestRelease().then(
      (json) => {
        if (live) applyRelease(json);
      },
      () => {
        if (live) failRelease();
      },
    );
    return () => {
      live = false;
    };
  }, []);

  function retry() {
    setLoading(true);
    setError(false);
    requestRelease().then(applyRelease, failRelease);
  }

  const date = release?.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  const apk = release?.android[0];

  const steps = (items: { icon: typeof Monitor; title: string; text: React.ReactNode }[]) => (
    <ol className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3">
      {items.map(({ icon: StepIcon, title, text }, index) => (
        <li key={title} className="rounded-xl border border-border bg-surface p-4">
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-subtle-fg">
            <StepIcon className="size-4" aria-hidden />
            <span>{index + 1}. {title}</span>
          </p>
          <p className="text-xs leading-relaxed text-fg-muted">{text}</p>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="mx-auto mt-10 w-full min-w-0 max-w-6xl">
      {/* ── Recommended device card ── */}
      <Card className="ring-gradient shine anim-scale-in min-w-0 overflow-hidden border border-brand/30 bg-bg-subtle/90 p-6 shadow-2xl sm:p-10">
        {os === "android" ? (
          /* ── Android: the APK ── */
          <div className="flex w-full flex-col gap-6">
            <div className="flex flex-col items-start justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <span className="grid size-16 shrink-0 place-items-center rounded-2xl border border-brand/30 bg-brand-subtle text-brand-subtle-fg">
                  <Smartphone className="size-8 sm:size-9" aria-hidden />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">Android APK{release?.version ? ` · ${release.version}` : ""}</Badge>
                    <span className="text-xs font-semibold text-fg-muted">{td("androidAbi")}</span>
                  </div>
                  <h2 className="mt-1 text-2xl font-black text-fg">{td("androidTitle")}</h2>
                  <p className="mt-0.5 text-sm text-fg-muted">{td("androidText")}</p>
                </div>
              </div>
              <div className="w-full shrink-0 sm:w-auto">
                <Button size="lg" asChild className="w-full rounded-xl px-6 font-black sm:w-auto">
                  <a href={apk?.url || LATEST_ANDROID_APK_URL} download>
                    <Download className="mr-2 size-5" aria-hidden />
                    <span>{apk?.sizeMB ? td("androidDownloadSize", { size: apk.sizeMB }) : td("androidDownload")}</span>
                  </a>
                </Button>
              </div>
            </div>
            {steps([
              { icon: ShieldCheck, title: td("androidStep1Title"), text: td.rich("androidStep1Text", { file: (chunks) => <code className="text-brand-subtle-fg">{chunks}</code> }) },
              { icon: CheckCircle2, title: td("androidStep2Title"), text: td("androidStep2Text") },
              { icon: Sparkles, title: td("androidStep3Title"), text: td("androidStep3Text") },
            ])}
          </div>
        ) : os === "ios" ? (
          /* ── iPhone / iPad: the web app on the home screen ── */
          <div className="flex w-full flex-col gap-6">
            <div className="flex flex-col items-start justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <span className="grid size-16 shrink-0 place-items-center rounded-2xl border border-warning-border bg-warning-bg text-warning">
                  <Smartphone className="size-8 sm:size-9" aria-hidden />
                </span>
                <div>
                  <Badge variant="neutral">iPhone &amp; iPad</Badge>
                  <h2 className="mt-1 text-2xl font-black text-fg">{td("iosTitle")}</h2>
                  <p className="mt-0.5 text-sm text-fg-muted">{td("iosText")}</p>
                </div>
              </div>
              <div className="w-full shrink-0 sm:w-auto">
                <Button size="lg" asChild className="w-full rounded-xl px-6 font-black sm:w-auto">
                  <Link href="/mock">
                    <Sparkles className="mr-2 size-5" aria-hidden />
                    <span>{td("iosOpen")}</span>
                  </Link>
                </Button>
              </div>
            </div>
            {steps([
              { icon: Share2, title: td("iosStep1Title"), text: td("iosStep1Text") },
              { icon: PlusSquare, title: td("iosStep2Title"), text: td("iosStep2Text") },
              { icon: CheckCircle2, title: td("iosStep3Title"), text: td("iosStep3Text") },
            ])}
          </div>
        ) : loading ? (
          <p className="inline-flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
            {t("desktopDetecting")}
          </p>
        ) : error || !release ? (
          <div className="flex items-start gap-3" role="alert">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="font-semibold text-fg">{t("desktopLoadFailed")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={retry}>
                  <RefreshCw className="mr-1.5 size-4" aria-hidden />
                  {t("desktopRetry")}
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                    {t("desktopAllDownloads")}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* ── Windows / macOS / Linux ── */
          <div className="flex w-full min-w-0 flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl border border-brand/30 bg-brand-subtle text-brand-subtle-fg sm:size-20">
              <Download className="size-8 sm:size-9" aria-hidden />
            </span>
            <div className="w-full min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-fg-muted">
                {os in OS_META ? (
                  <Badge variant="success">
                    <span aria-hidden className="anim-glow mr-1 inline-block size-1.5 shrink-0 rounded-full bg-current" />
                    <span>{t("desktopRecommended")}</span>
                  </Badge>
                ) : (
                  <Badge variant="warning">{t("desktopUnknownNote")}</Badge>
                )}
                {os in OS_META && (
                  <span className="font-semibold text-fg">
                    {OS_META[os as keyof typeof OS_META].label} · {t("desktopVersion")} {release.version}
                  </span>
                )}
              </div>

              {os in OS_META && (release[os as "windows" | "macos" | "linux"] ?? [])[0] ? (
                <div className="mt-4 flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                  <Button size="lg" asChild className="min-h-13 w-full rounded-xl px-8 font-black sm:w-auto">
                    <a href={release[os as "windows" | "macos" | "linux"][0].url} rel="noopener noreferrer">
                      <Download className="mr-2 size-5 shrink-0" aria-hidden />
                      <span>{t("desktopDownload")} · {release[os as "windows" | "macos" | "linux"][0].sizeMB}</span>
                    </a>
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">{os in OS_META ? t("desktopNoAssets") : t("desktopUnknownNote")}</p>
              )}

              {date && (
                <p className="mt-2 text-xs text-fg-subtle">
                  {t("desktopReleased")}: {date}
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Every platform of the latest release ── */}
      {!loading && release && (
        <div className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-fg">
            <Laptop className="size-5 text-brand" aria-hidden />
            <span>{td("allPlatforms", { version: release.version })}</span>
          </h2>

          <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {(["windows", "macos", "linux", "android"] as const).map((key) => {
              const Icon = OS_META[key].icon;
              const assets = release[key];
              const isRec = os === key;
              return (
                <Card
                  key={key}
                  className={cn(
                    "lift flex min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border bg-bg-subtle p-5 transition-all",
                    isRec ? "border-brand/50 shadow-lg" : "border-border hover:border-border-strong",
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border pb-3">
                    <span className="inline-flex items-center gap-2 font-bold text-fg">
                      <Icon className="size-5 shrink-0 text-brand" aria-hidden />
                      <span className="truncate">{OS_META[key].label}</span>
                    </span>
                    {isRec ? (
                      <Badge variant="success" className="text-[10px] font-bold">{td("thisDevice")}</Badge>
                    ) : (
                      <span className="text-[10px] font-medium text-fg-subtle">{OS_META[key].badge}</span>
                    )}
                  </div>

                  <div className="mt-4 flex min-w-0 flex-1 flex-col gap-2">
                    {assets.length === 0 ? (
                      <p className="text-xs text-fg-muted">{t("desktopNoAssets")}</p>
                    ) : (
                      assets.map((a) => (
                        <Button
                          key={a.url}
                          variant="outline"
                          size="sm"
                          asChild
                          className="h-auto w-full justify-start overflow-hidden rounded-xl px-3 py-2.5 text-left"
                        >
                          <a href={a.url} rel="noopener noreferrer" title={a.name} className="w-full">
                            <Download className="mr-2 size-4 shrink-0 text-brand" aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">{a.name}</span>
                            <span className="ml-2 shrink-0 font-mono text-[11px] text-fg-subtle">{a.sizeMB}</span>
                          </a>
                        </Button>
                      ))
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-fg-subtle">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-semibold text-brand-subtle-fg underline underline-offset-4 hover:text-brand"
        >
          <FileDown className="size-4" aria-hidden />
          <span>{t("desktopAllDownloads")}</span>
        </a>
      </p>
    </div>
  );
}
