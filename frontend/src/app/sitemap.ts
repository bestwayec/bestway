import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://bestwayec.uz";
  const routes = [
    "",
    "/mock",
    "/desktop",
    "/login",
    "/register",
  ];

  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const route of routes) {
    // Default Uzbek route
    entries.push({
      url: `${baseUrl}${route}`,
      lastModified: now,
      changeFrequency: route === "" || route === "/mock" ? "daily" : "weekly",
      priority: route === "" ? 1.0 : route === "/mock" || route === "/desktop" ? 0.9 : 0.7,
      alternates: {
        languages: {
          uz: `${baseUrl}${route}`,
          en: `${baseUrl}/en${route}`,
        },
      },
    });

    // English route
    entries.push({
      url: `${baseUrl}/en${route}`,
      lastModified: now,
      changeFrequency: route === "" || route === "/mock" ? "daily" : "weekly",
      priority: route === "" ? 0.9 : 0.8,
      alternates: {
        languages: {
          uz: `${baseUrl}${route}`,
          en: `${baseUrl}/en${route}`,
        },
      },
    });
  }

  return entries;
}
