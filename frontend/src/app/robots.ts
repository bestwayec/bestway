import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://bestwayec.uz";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/mock", "/desktop", "/login", "/register", "/en/"],
        disallow: ["/api/", "/admin/", "/teacher/", "/dashboard/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
