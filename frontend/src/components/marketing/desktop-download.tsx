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
const CURRENT_VERSION = "v1.0.9";
const RELEASES_URL = `https://github.com/${REPO}/releases/tag/${CURRENT_VERSION}`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const LATEST_RELEASE_BASE = `https://github.com/${REPO}/releases/download/${CURRENT_VERSION}`;

const LATEST_WINDOWS_SETUP_URL = `${LATEST_RELEASE_BASE}/Bestway.App_1.0.9_x64-setup.exe`;
const LATEST_ANDROID_APK_URL = `${LATEST_RELEASE_BASE}/Bestway.App_1.0.9_universal.apk`;

const FALLBACK_RELEASE: ReleaseInfo = {
  version: "v1.0.9",
  publishedAt: "2026-10-28T18:00:00Z",
  windows: [
    {
      name: "Bestway.App_1.0.9_x64-setup.exe",
      url: LATEST_WINDOWS_SETUP_URL,
      sizeMB: "4.2 MB",
    },
    {
      name: "Bestway.App_1.0.9_x64_en-US.msi",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_1.0.9_x64_en-US.msi`,
      sizeMB: "3.9 MB",
    },
  ],
  macos: [
    {
      name: "Bestway.App_1.0.9_aarch64.dmg · Apple Silicon",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_1.0.9_aarch64.dmg`,
      sizeMB: "7.1 MB",
    },
    {
      name: "Bestway.App_1.0.9_x64.dmg · Intel",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_1.0.9_x64.dmg`,
      sizeMB: "7.4 MB",
    },
  ],
  linux: [
    {
      name: "Bestway.App_1.0.9_amd64.deb · Debian / Ubuntu",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_1.0.9_amd64.deb`,
      sizeMB: "6.2 MB",
    },
    {
      name: "Bestway.App_1.0.9_amd64.AppImage · Standalone",
      url: `${LATEST_RELEASE_BASE}/Bestway.App_1.0.9_amd64.AppImage`,
      sizeMB: "86.5 MB",
    },
  ],
  android: [
    {
      name: "Bestway.App_1.0.9_universal.apk · Universal APK",
      url: LATEST_ANDROID_APK_URL,
      sizeMB: "44.8 MB",
    },
  ],
};

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
  if (windows.length === 0) {
    windows.push(...FALLBACK_RELEASE.windows);
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
  if (macos.length === 0) {
    macos.push(...FALLBACK_RELEASE.macos);
  }

  // Linux
  const linux = names
    .filter((a) => /\.appimage$|\.deb$/i.test(a.name))
    .sort((a, b) => Number(/\.deb$/i.test(a.name)) - Number(/\.deb$/i.test(b.name)))
    .map((a) => ({ name: a.name, url: a.url, sizeMB: fmt(a.size) }));
  if (linux.length === 0) {
    linux.push(...FALLBACK_RELEASE.linux);
  }

  // Android
  const android = names
    .filter((a) => /\.apk$/i.test(a.name))
    .map((a) => ({ name: a.name, url: a.url, sizeMB: fmt(a.size) }));
  if (android.length === 0) {
    android.push(...FALLBACK_RELEASE.android);
  }

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
      (json.assets ?? []).map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
      })),
    );
    setRelease({
      version: String(json.tag_name ?? "").replace(/^bestway-app-v|^v?/, "v") || CURRENT_VERSION,
      publishedAt: json.published_at || "2026-10-28T18:00:00Z",
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

  const date = release?.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto mt-10 w-full min-w-0 max-w-6xl">
      {/* ── Recommended Device Hero Card ── */}
      <Card className="ring-gradient shine anim-scale-in min-w-0 overflow-hidden p-6 sm:p-10 border border-emerald-500/30 bg-[#0B0F17]/90 shadow-2xl">
        {loading ? (
          <p className="inline-flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Loader2 className="size-4 animate-spin text-emerald-500" aria-hidden />
            {t("desktopDetecting")}
          </p>
        ) : os === "android" ? (
          /* ── Dedicated Android Native APK Card ── */
          <div className="flex w-full flex-col gap-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
              <div className="flex items-center gap-4">
                <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <Smartphone className="size-8 sm:size-9" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="success" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      Android APK · v1.0.9
                    </Badge>
                    <span className="text-xs font-semibold text-emerald-300">
                      Universal ABI (64-bit / 32-bit)
                    </span>
                  </div>
                  <h2 className="mt-1 text-2xl font-black text-white">BestWay Android Ilovasi</h2>
                  <p className="text-sm text-slate-300 mt-0.5">
                    Telefon va planshetlar uchun rasmiy APK. Lug&apos;at mashqlari, Subway Vocab Runner o&apos;yini va CBT testlarni mobil qurilmangizda topshiring.
                  </p>
                </div>
              </div>

              <div className="shrink-0 w-full sm:w-auto">
                <Button
                  size="lg"
                  asChild
                  className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-6 py-4 rounded-xl shadow-lg shadow-emerald-500/25 transition-transform hover:scale-105"
                >
                  <a href={release?.android[0]?.url || LATEST_ANDROID_APK_URL} download>
                    <Download className="size-5 mr-2" />
                    <span>BestWay APK Yuklab Olish ({release?.android[0]?.sizeMB || "44.8 MB"})</span>
                  </a>
                </Button>
              </div>
            </div>

            {/* Android Safety & Install Instructions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="rounded-xl border border-white/10 bg-[#111827]/60 p-4">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <ShieldCheck className="size-4" />
                  <span>1. Faylni Yuklab Oling</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Tugmani bosing va <code className="text-emerald-300">Bestway.App_1.0.9_universal.apk</code> faylini qurilmangizga saqlang.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#111827]/60 p-4">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <CheckCircle2 className="size-4" />
                  <span>2. Ruxsat Bering</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Brauzer ogohlantirish bersa, sozlamalardan &quot;Ushbu manbadan o&apos;rnatish&quot; (Allow from this source) ruxsatini yoqing.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#111827]/60 p-4">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <Sparkles className="size-4" />
                  <span>3. Hisobingizga Kiring</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  O&apos;rnatilgan ilovani oching va BestWay o&apos;quvchi yoki o&apos;qituvchi profilingiz orqali tizimga kiring.
                </p>
              </div>
            </div>
          </div>
        ) : os === "ios" ? (
          /* ── Dedicated Apple iOS PWA Card ── */
          <div className="flex w-full flex-col gap-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
              <div className="flex items-center gap-4">
                <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <Smartphone className="size-8 sm:size-9" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral" className="bg-amber-500/20 text-amber-400 border-amber-500/30 font-bold">
                      Apple iOS (iPhone & iPad)
                    </Badge>
                    <span className="text-xs font-semibold text-slate-300">
                      App Store relizi tez kunda
                    </span>
                  </div>
                  <h2 className="mt-1 text-2xl font-black text-white">iPhone va iPad uchun Web Ilova (PWA)</h2>
                  <p className="text-sm text-slate-300 mt-0.5">
                    BestWay platformasini Safari orqali Bosh Ekranga qo&apos;shib, xuddi to&apos;liq mobil ilova kabi foydalanishingiz mumkin.
                  </p>
                </div>
              </div>

              <div className="shrink-0 w-full sm:w-auto">
                <Button
                  size="lg"
                  asChild
                  className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-6 py-4 rounded-xl shadow-lg shadow-amber-500/25 transition-transform hover:scale-105"
                >
                  <Link href="/mock">
                    <Sparkles className="size-5 mr-2" />
                    <span>Platformaga Kirish (Web)</span>
                  </Link>
                </Button>
              </div>
            </div>

            {/* iOS PWA 3-Step Guide */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="rounded-xl border border-white/10 bg-[#111827]/60 p-4">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <Share2 className="size-4" />
                  <span>1. Ulashish Tugmasi</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Safari brauzerining pastki panelidagi <strong className="text-white">Ulashish (Share)</strong> tugmasini bosing: <span className="text-sm">⎋</span>
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#111827]/60 p-4">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <PlusSquare className="size-4" />
                  <span>2. Bosh Ekranga Qo&apos;shish</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Ochilgan menyuni biroz pastga suring va <strong className="text-white">&quot;Bosh ekranga qo&apos;shish&quot; (Add to Home Screen)</strong> bandini tanlang.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#111827]/60 p-4">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <CheckCircle2 className="size-4" />
                  <span>3. Qo&apos;shishni Bosing</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Yuqori o&apos;ng burchakdagi <strong className="text-white">&quot;Qo&apos;shish&quot;</strong> tugmasini bosing. Ilova belgisi telefoningiz ish stolida tayyor bo&apos;ladi!
                </p>
              </div>
            </div>
          </div>
        ) : error || !release ? (
          <div className="flex items-start gap-3" role="alert">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-400" aria-hidden />
            <div>
              <p className="font-semibold text-white">{t("desktopLoadFailed")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={retry}>
                  <RefreshCw className="size-4 mr-1.5" />
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
          /* ── Desktop OS (Windows / macOS / Linux) Hero Card ── */
          <div className="flex w-full min-w-0 flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 sm:size-20">
              <Download className="size-8 sm:size-9" aria-hidden />
            </span>
            <div className="w-full min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-300">
                {os in OS_META ? (
                  <Badge variant="success" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold">
                    <span aria-hidden className="anim-glow inline-block size-1.5 shrink-0 rounded-full bg-current mr-1" />
                    <span>{t("desktopRecommended")}</span>
                  </Badge>
                ) : (
                  <Badge variant="warning">{t("desktopUnknownNote")}</Badge>
                )}
                {os in OS_META && (
                  <span className="font-semibold text-white">
                    {OS_META[os as keyof typeof OS_META].label} · {t("desktopVersion")} {release.version}
                  </span>
                )}
              </div>

              {os in OS_META && release[os as keyof ReleaseInfo] ? (
                <div className="mt-4 flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                  <Button
                    size="lg"
                    asChild
                    className="min-h-13 w-full sm:w-auto bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-8 py-3 rounded-xl shadow-lg shadow-emerald-500/25 transition-transform hover:scale-105"
                  >
                    <a
                      href={(release[os as "windows" | "macos" | "linux" | "android"] as ReleaseAsset[])[0]?.url || LATEST_WINDOWS_SETUP_URL}
                      rel="noopener noreferrer"
                    >
                      <Download className="size-5 mr-2 shrink-0" />
                      <span>
                        {t("desktopDownload")} ·{" "}
                        {(release[os as "windows" | "macos" | "linux" | "android"] as ReleaseAsset[])[0]?.sizeMB || "4.2 MB"}
                      </span>
                    </a>
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-400">{t("desktopUnknownNote")}</p>
              )}

              {date && (
                <p className="mt-2 text-xs text-slate-400">
                  {t("desktopReleased")}: {date}
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── All platforms Grid (Windows, macOS, Linux, Android) ── */}
      {!loading && release && (
        <div className="mt-8">
          <h2 className="text-lg font-black text-white mb-4 flex items-center gap-2">
            <Laptop className="size-5 text-emerald-400" />
            <span>Barcha Platformalar Uchun O&apos;rnatgichlar ({release.version})</span>
          </h2>

          <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {(["windows", "macos", "linux", "android"] as const).map((key, i) => {
              const Icon = OS_META[key].icon;
              const assets = release[key];
              const isRec = os === key;
              return (
                <Card
                  key={key}
                  className={cn(
                    "lift flex min-w-0 max-w-full flex-col overflow-hidden p-5 rounded-2xl border bg-[#0B0F17] transition-all",
                    isRec ? "border-emerald-500/50 shadow-lg shadow-emerald-500/10" : "border-white/10 hover:border-white/20",
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2 pb-3 border-b border-white/5">
                    <span className="inline-flex items-center gap-2 font-bold text-white">
                      <Icon className="size-5 shrink-0 text-emerald-400" aria-hidden />
                      <span className="truncate">{OS_META[key].label}</span>
                    </span>
                    {isRec ? (
                      <Badge variant="success" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] font-bold">
                        Sizda
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-medium">
                        {OS_META[key].badge}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex min-w-0 flex-1 flex-col gap-2">
                    {assets.length === 0 ? (
                      <p className="text-xs text-slate-400">{t("desktopNoAssets")}</p>
                    ) : (
                      assets.map((a) => (
                        <Button
                          key={a.url}
                          variant="outline"
                          size="sm"
                          asChild
                          className="h-auto w-full justify-start overflow-hidden py-2.5 px-3 rounded-xl border-white/10 bg-[#111827]/50 hover:bg-emerald-500/10 hover:border-emerald-500/30 transition text-left"
                        >
                          <a href={a.url} rel="noopener noreferrer" title={a.name} className="w-full">
                            <Download className="size-4 shrink-0 text-emerald-400 mr-2" />
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
                              {a.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-400 font-mono ml-2">
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
        </div>
      )}

      <p className="mt-8 text-center text-xs text-slate-400">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
        >
          <FileDown className="size-4" />
          <span>{t("desktopAllDownloads")}</span>
        </a>
      </p>
    </div>
  );
}
