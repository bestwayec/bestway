import type { MetadataRoute } from "next";
import { CENTER } from "@/lib/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${CENTER.name} — ${CENTER.tagline}`,
    short_name: CENTER.name,
    description: CENTER.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#0b0d08",
    theme_color: "#0b0d08",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/logo-800.png",
        sizes: "800x800",
        type: "image/png",
      },
      {
        src: "/logo.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
