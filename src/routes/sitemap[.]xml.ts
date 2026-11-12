import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_TICKERS } from "@/lib/public-company";

const BASE_URL = "https://filedunder.ai";
// Public, indexable pages only; everything under /app needs sign-in.
const STATIC_PATHS = ["/", "/pricing", "/companies", "/research"];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Published primers come from the database; if that read fails the rest of the sitemap is still served.
        const { listPublicReports } = await import("@/lib/public-report.functions");
        const primers = await listPublicReports().catch(() => []);
        const urls = [
          ...[...STATIC_PATHS, ...PUBLIC_TICKERS.map((t) => `/companies/${t}`)].map((p) => `<url><loc>${BASE_URL}${p}</loc></url>`),
          ...primers.map((r) => `<url><loc>${BASE_URL}/research/${encodeURIComponent(r.ticker)}</loc><lastmod>${r.updatedAt.slice(0, 10)}</lastmod></url>`),
        ];
        const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
        return new Response(xml, { headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" } });
      },
    },
  },
});
