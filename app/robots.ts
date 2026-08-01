import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://hotu.com.co/sitemap.xml", // TODO: cambiar por tu dominio real
  };
}
