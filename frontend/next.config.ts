import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  turbopack: {
    // Ignore unrelated lockfiles above the repository (for example ~/package-lock.json).
    root: dirname(fileURLToPath(import.meta.url)),
  },

  // 1. Turbopack / Webpack tunnelni bloklamasligi uchun (Terminal so'ragan asosiy sozlama)
  // Diqqat: BARE host yoziladi (sxemasiz) — 'https://' bilan hech qachon match bo'lmaydi.
  // Prod'da ta'siri yo'q (faqat `next dev`), local quick-tunnel uchun wildcard qoldirildi.
  allowedDevOrigins: [
    '*.trycloudflare.com'
  ],

  async redirects() {
    return [
      {
        source: '/download',
        destination: '/desktop',
        permanent: false,
      },
      {
        source: '/:locale/download',
        destination: '/:locale/desktop',
        permanent: false,
      },
    ];
  },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24,
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "3001" },
      { protocol: "https", hostname: "api.bestwayec.uz" },
      // picsum.photos fallback for teachers/gallery (kept intentionally)
      { protocol: "https", hostname: "picsum.photos" },
      ...(process.env.NEXT_PUBLIC_MEDIA_HOST
        ? [{ protocol: "https" as const, hostname: process.env.NEXT_PUBLIC_MEDIA_HOST }]
        : []),
    ],
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },

  experimental: {
    // Video upload max 500MB (backend MAX_UPLOAD_MB=500). Proxy body'ni xotiraga
    // bufferlaydi (route.ts `arrayBuffer`), shuning uchun bir vaqtning o'zida
    // bir nechta katta upload RAM'ni to'ldirishi mumkin — VPS'da kuzating.
    proxyClientMaxBodySize: "500mb",
    serverActions: {
      allowedOrigins: [
        "bestwayec.uz",
        "www.bestwayec.uz",
      ],
    },
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "gsap",
      "ogl",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-avatar",
    ],
  },
};

export default withNextIntl(nextConfig);
