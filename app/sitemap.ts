import type { MetadataRoute } from "next";

const BASE_URL = "https://hotu.com.co"; // TODO: cambiar por tu dominio real

const ROUTES = ["", "/noticias", "/eventos", "/artistas", "/colectivos", "/sets", "/discografia", "/tienda"];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: route === "" ? 1 : 0.7,
  }));
}
