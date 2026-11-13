// Registers the copied partner IR files (ir-documents/partner/...) as regular ir_documents rows,
// so our own readers, renditions and series builds treat them like any other stored document.
// Skips files we already hold (same source URL or sha256) and files not yet copied.
// Usage: bun scripts/ir-import-partner.ts [--tickers=AAPL,MSFT]
import { sb, args, log } from "./lib/supa";

const KIND: Record<string, string> = {
  release: "press-release", supplement: "supplement", presentation: "presentation",
  transcript: "transcript", remarks: "transcript", sec_filing: "sec-copy", annual_report: "report", other: "other",
};

async function all<T>(q: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const tickers = args.tickers
  ? args.tickers.split(",")
  : [...new Set((await all<{ ticker: string }>((f) => sb.from("partner_mirror").select("ticker").eq("kind", "original").eq("status", "done").range(f, f + 999))).map((r) => r.ticker))];
log(`importing ${tickers.length} companies`);
let added = 0, dup = 0, missing = 0;
for (const t of tickers) {
  const { data: blob } = await sb.storage.from("datasets").download(`ir/${t}.json`);
  if (!blob) continue;
  const docs = JSON.parse(await blob.text()).documents as any[];
  const copied = new Set((await all<{ path: string }>((f) => sb.from("partner_mirror").select("path").eq("ticker", t).eq("kind", "original").eq("status", "done").range(f, f + 999))).map((r) => r.path));
  const have = await all<{ source_url: string; sha256: string | null }>((f) => sb.from("ir_documents").select("source_url,sha256").eq("ticker", t).range(f, f + 999));
  const urls = new Set(have.map((h) => h.source_url)), shas = new Set(have.map((h) => h.sha256).filter(Boolean));
  const rows = [];
  for (const d of docs) {
    if (!copied.has(d.storage_path)) { missing++; continue; }
    if (urls.has(d.url) || (d.sha256 && shas.has(d.sha256))) { dup++; continue; }
    urls.add(d.url); if (d.sha256) shas.add(d.sha256);
    const ext = (d.ext ?? "").replace(/^\./, "").toLowerCase();
    const kind = ext === "xlsx" || ext === "xls" ? "data" : KIND[d.doc_type] ?? "other";
    rows.push({
      ticker: t, source: "partner", source_url: d.url, kind, title: d.title ?? d.url,
      period: d.fiscal_label ?? null, filed: d.published ?? null, content_type: d.content_type ?? null,
      ext, bytes: d.bytes ?? null, sha256: d.sha256 ?? null, path: `partner/${d.storage_path}`,
      pages: d.pages ?? null, fetched_at: d.fetched_at ?? new Date().toISOString(),
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("ir_documents").upsert(rows.slice(i, i + 500), { onConflict: "source_url", ignoreDuplicates: true });
    if (error) throw new Error(`${t}: ${error.message}`);
  }
  added += rows.length;
  log(`${t}: +${rows.length}`);
}
log(`done: ${added} added, ${dup} already held, ${missing} not copied yet`);
