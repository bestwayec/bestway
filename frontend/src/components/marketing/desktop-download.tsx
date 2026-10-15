"use client";

import * as React from "react";
import {
  Download,
  FileDown,
  Laptop,
  Loader2,
  Monitor,
  RefreshCw,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const REPO = "bestwayec/bw-tauri";
const RELEASES_URL = `https://github.com/${REPO}/releases/tag/bestway-app-v0.5.9`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const LATEST_RELEASE_BASE = `https://github.com/${REPO}/releases/download/bestway-app-v0.5.9`;
const LATEST_WINDOWS_SETUP_URL = `${LATEST_RELEASE_BASE}/Bestway.App_0.5.9_x64-setup.exe`;
const FALLBACK_SERVER_WINDOWS_SETUP_URL =
  "https://bestwayec.uz/media/downloads/Bestway.App_0.5.9_x64-setup.exe";

const FALLBACK_RELEASE: ReleaseInfo = {
  version: "v0.5.9",
  publishedAt: "2026-10-15T00:00:00Z",
  windows: [
    {
      name: "Bestway.App_0.5.9_x64-setup.exe",
      url: LATEST_WINDOWS_SETUP_URL,
      sizeMB: "3.5 MB",
    },
  ],
  macos: [
    {
      name: "Bestway.App_0.5.9_aarch64.dmg · Apple Silicon",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_0.5.9_aarch64.dmg`,
      sizeMB: "6.6 MB",
    },
    {
      name: "Bestway.App_0.5.9_x64.dmg · Intel",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_0.5.9_x64.dmg`,
      sizeMB: "6.9 MB",
    },
  ],
  linux: [
    {
      name: "Bestway.App_0.5.9_amd64.deb · Debian / Ubuntu",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_0.5.9_amd64.deb`,
      sizeMB: "5.7 MB",
    },
    {
      name: "Bestway.App_0.5.9_amd64.AppImage · Standalone",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_0.5.9_amd64.AppImage`,
      sizeMB: "84.0 MB",
    },
  ],
};

type Os = "windows" | "macos" | "linux" | "mobile" | "unknown";

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
}

function detectOs(): Os {
  if (typeof navigator === "undefined") return "unknown";
  const uaData = navigator as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean };
  };
  const platform = uaData.userAgentData?.platform?.toLowerCase() ?? "";
  if (uaData.userAgentData?.mobile) return "mobile";
  if (/win/.test(platform)) return "windows";
  if (/mac/.test(platform)) return "macos";
  if (/linux|chromeos|ubuntu/.test(platform)) return "linux";
  const ua = navigator.userAgent.toLowerCase();
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return "mobile";
  if (/win/.test(ua)) return "windows";
  if (/mac/.test(ua)) return "macos";
  if (/linux|x11/.test(ua)) return "linux";
  return "unknown";
}

function pickAssets(names: { name: string; url: string; size: number }[]): {
  windows: ReleaseAsset[];
  macos: ReleaseAsset[];
  linux: ReleaseAsset[];
} {
  const fmt = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;
  const lower = (n: string) => n.toLowerCase();
  const windowsSeen = new Set<string>();
  const windows: ReleaseAsset[] = [];
  const rawWindows = names
    .filter((a) => /\.exe$|\.msi$/i.test(a.name) && !/0\.5\.[0-7]/i.test(a.name))
    .sort((a, b) => Number(/setup/i.test(b.name)) - Number(/setup/i.test(a.name)));
  for (const a of rawWindows) {
    if (!windowsSeen.has(a.name)) {
      windowsSeen.add(a.name);
      windows.push({ name: a.name, url: a.url, sizeMB: fmt(a.size) });
      break;
    }
  }
  if (windows.length === 0) {
    const anyExe = names.find((a) => /\.exe$/i.test(a.name));
    windows.push(
      anyExe
        ? { name: anyExe.name, url: anyExe.url, sizeMB: fmt(anyExe.size) }
        : {
            name: "Bestway.App_0.5.9_x64-setup.exe",
            url: LATEST_WINDOWS_SETUP_URL,
            sizeMB: "3.5 MB",
          }
    );
  }
  const macos = names
    .filter((a) => /\.dmg$/i.test(a.name))
    .map((a) => {
      const n = lower(a.name);
      const arch = /arm64|aarch64/.test(n) ? "Apple Silicon" : /x64|intel/.test(n) ? "Intel" : null;
      return { name: arch ? `${a.name} · ${arch}` : a.name, url: a.url, sizeMB: fmt(a.size) };
    });
  if (macos.length === 0) {
    macos.push(...FALLBACK_RELEASE.macos);
  }
  const linux = names
    .filter((a) => /\.appimage$|\.deb$/i.test(a.name))
    .sort((a, b) => Number(/\.appimage$/i.test(a.name)) - Number(/\.appimage$/i.test(b.name)))
    .map((a) => ({ name: a.name, url: a.url, sizeMB: fmt(a.size) }));
  if (linux.length === 0) {
    linux.push(...FALLBACK_RELEASE.linux);
  }
  return { windows, macos, linux };
}

const OS_META: Record<Exclude<Os, "mobile" | "unknown">, { icon: typeof Monitor; label: string }> = {
  windows: { icon: Monitor, label: "Windows" },
  macos: { icon: Laptop, label: "macOS" },
  linux: { icon: Terminal, label: "Linux" },
};

export function DesktopDownload() {
  const t = useTranslations("marketing");
  const [os] = React.useState<Os>(() => detectOs());
  const [release, setRelease] = React.useState<ReleaseInfo | null>(FALLBACK_RELEASE);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  function applyRelease(json: {
    tag_name: string;
    published_at: string;
    assets: { name: string; browser_download_url: string; size: number }[];
  }) {
    const picked = pickAssets(
      (json.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    );
    setRelease({
      version: String(json.tag_name ?? "").replace(/^bestway-app-v/, "v") || "v0.5.9",
      publishedAt: json.published_at,
      ...picked,
    });
    setError(false);
    setLoading(false);
  }

  function failRelease() {
    setRelease(FALLBACK_RELEASE);
    setError(false);
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

  const recommended = os === "windows" || os === "macos" || os === "linux" ? os : null;
  const recommendedAssets = recommended && release ? release[recommended] : [];
  const date = release?.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto mt-10 w-full min-w-0 max-w-6xl">
      {/* ── Recommended for this device ── */}
      <Card className="ring-gradient shine anim-scale-in min-w-0 overflow-hidden p-5 sm:p-10">
        {loading ? (
          <p className="inline-flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("desktopDetecting")}
          </p>
        ) : os === "mobile" ? (
          <div className="flex items-start gap-3">
            <Laptop className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="font-semibold text-fg">{t("desktopYourOs")}: mobile</p>
              <p className="mt-1 text-sm text-fg-muted">{t("desktopMobileNote")}</p>
              <a
                href={RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
              >
                <FileDown className="size-4" aria-hidden />
                {t("desktopAllDownloads")}
              </a>
            </div>
          </div>
        ) : error || !release ? (
          <div className="flex items-start gap-3" role="alert">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="font-semibold text-fg">{t("desktopLoadFailed")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={retry}>
                  <RefreshCw className="size-4" aria-hidden />
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
          <div className="flex w-full min-w-0 flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand-subtle text-brand-subtle-fg sm:size-20">
              <Download className="size-8 sm:size-9" aria-hidden />
            </span>
            <div className="w-full min-w-0 flex-1">
              <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-fg-muted">
                {recommended ? (
                  <Badge variant="success" className="max-w-full min-w-0">
                    <span aria-hidden className="anim-glow inline-block size-1.5 shrink-0 rounded-full bg-current" />
                    <span className="min-w-0 truncate">{t("desktopRecommended")}</span>
                  </Badge>
                ) : (
                  <Badge variant="warning" className="max-w-full">
                    {t("desktopUnknownNote")}
                  </Badge>
                )}
                {recommended && (
                  <span className="min-w-0 font-semibold break-words text-fg">
                    {OS_META[recommended].label}
                    {release.version ? ` · ${t("desktopVersion")} ${release.version}` : ""}
                  </span>
                )}
              </p>
              {recommended && recommendedAssets.length > 0 ? (
                <div className="mt-4 flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                  <Button
                    size="lg"
                    asChild
                    className="min-h-13 w-full max-w-full min-w-0 justify-center px-4 sm:w-auto sm:px-8"
                  >
                    <a href={recommendedAssets[0].url} rel="noopener noreferrer" className="min-w-0">
                      <Download className="size-5 shrink-0" aria-hidden />
                      <span className="min-w-0 truncate">
                        {t("desktopDownload")} · {recommendedAssets[0].sizeMB}
                      </span>
                    </a>
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">
                  {recommended ? t("desktopNoAssets") : t("desktopUnknownNote")}
                </p>
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

      {/* ── All platforms ── */}
      {!loading && release && (
        <div className="mt-6 grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-3">
          {(Object.keys(OS_META) as (keyof typeof OS_META)[]).map((key, i) => {
            const Icon = OS_META[key].icon;
            const assets = release[key];
            const isRec = recommended === key;
            return (
              <Card
                key={key}
                className={cn(
                  "lift anim-scale-in flex min-w-0 max-w-full flex-col overflow-hidden p-5 sm:p-6",
                  isRec && "border-brand/50",
                )}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-fg">
                    <Icon className="size-5 shrink-0 text-brand" aria-hidden />
                    <span className="min-w-0 truncate">{OS_META[key].label}</span>
                  </span>
                  {isRec && (
                    <Badge variant="success" className="max-w-full min-w-0 shrink-0">
                      <span className="min-w-0 truncate">{t("desktopRecommended")}</span>
                    </Badge>
                  )}
                </div>
                <div className="mt-4 flex min-w-0 flex-1 flex-col gap-2.5">
                  {assets.length === 0 ? (
                    <p className="text-xs text-fg-subtle">{t("desktopNoAssets")}</p>
                  ) : (
                    assets.map((a) => (
                      <Button
                        key={a.url}
                        variant="outline"
                        size="sm"
                        asChild
                        className="h-auto max-w-full min-h-12 w-full min-w-0 justify-start overflow-hidden py-2.5 whitespace-normal"
                      >
                        <a
                          href={a.url}
                          rel="noopener noreferrer"
                          title={a.name}
                          className="min-w-0 w-full"
                        >
                          <Download className="size-4 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-left text-[13px]">{a.name}</span>
                          <span className="shrink-0 text-xs whitespace-nowrap text-fg-subtle tabular-nums">
                            {a.sizeMB}
                          </span>
                        </a>
                      </Button>
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-5 text-center text-xs text-fg-subtle">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          {t("desktopAllDownloads")}
        </a>
      </p>
    </div>
  );
}
