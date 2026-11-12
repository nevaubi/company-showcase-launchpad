import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_TICKERS } from "@/lib/public-company";

const BASE_URL = "https://filedunder.ai";
// Public, indexable pages only; everything under /app needs sign-in.
const STATIC_PATHS = ["/", "/pricing", "/companies"];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const paths = [...STATIC_PATHS, ...PUBLIC_TICKERS.map((t) => `/companies/${t}`)];
        const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths
          .map((p) => `<url><loc>${BASE_URL}${p}</loc></url>`)
          .join("")}</urlset>`;
        return new Response(xml, { headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" } });
      },
    },
  },
});
