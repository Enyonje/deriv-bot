import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/features", "/ai-trading", "/strategies", "/pricing", "/faq", "/about", "/contact", "/risk-disclosure", "/privacy", "/terms"];
  const now = new Date();
  return paths.map((path) => ({ url: siteUrl(path), lastModified: now, changeFrequency: path === "/" ? "weekly" : "monthly", priority: path === "/" ? 1 : 0.7 }));
}
