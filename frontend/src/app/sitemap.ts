import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://bestwayec.uz";
  const routes = [
    { path: "", priority: 1.0, changeFrequency: "daily" as const },
    { path: "/mock", priority: 0.9, changeFrequency: "daily" as const },
    { path: "/download", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/desktop", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/vocabulary", priority: 0.8, changeFrequency: "daily" as const },
    { path: "/vocabulary/runner", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/bamboozle", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/news", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/login", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/register", priority: 0.7, changeFrequency: "monthly" as const },
  ];

  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const { path, priority, changeFrequency } of routes) {
    // Default Uzbek route
    entries.push({
      url: `${baseUrl}${path}`,
      lastModified: now,
      changeFrequency,
      priority,
      alternates: {
        languages: {
          uz: `${baseUrl}${path}`,
          en: `${baseUrl}/en${path}`,
        },
      },
    });

    // English route
    entries.push({
      url: `${baseUrl}/en${path}`,
      lastModified: now,
      changeFrequency,
      priority: Math.max(0.6, priority - 0.1),
      alternates: {
        languages: {
          uz: `${baseUrl}${path}`,
          en: `${baseUrl}/en${path}`,
        },
      },
    });
  }

  return entries;
}
