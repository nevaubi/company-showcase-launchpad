// Read-only access to the partner Filed Under corpus (its published, publicly readable tables).
import { buildExternalPayload, type ExtDef, type ExtDoc, type ExtValue } from "@/lib/ir/external";
import type { IrPayload } from "@/lib/ir/payload";

const DEFAULT_URL = "https://apxfeteebnspwyajlxfh.supabase.co";

const CLIENT_CONFIG = "https://filedunderai.vercel.app/api/client-config";
let discovered: Promise<{ url: string; key: string } | null> | null = null;

/** Uses EXTERNAL_IR_URL/KEY when set; otherwise the partner site's published client (publishable) config. */
async function config() {
  const key = process.env["EXTERNAL_IR_KEY"];
  if (key) return { url: process.env["EXTERNAL_IR_URL"] || DEFAULT_URL, key };
  discovered ??= fetch(CLIENT_CONFIG, { signal: AbortSignal.timeout(8000) })
    .then((r) => r.json() as Promise<{ supabaseUrl?: string; publishableKey?: string }>)
    .then((j) => (j.publishableKey ? { url: j.supabaseUrl || DEFAULT_URL, key: j.publishableKey } : null))
    .catch(() => ((discovered = null), null));
  return discovered;
}

async function rest<T>(path: string, range?: [number, number]): Promise<T[]> {
  const c = await config();
  if (!c) throw new Error("Partner corpus key is not configured");
  const headers: Record<string, string> = { apikey: c.key, Accept: "application/json" };
  if (range) headers["Range"] = `${range[0]}-${range[1]}`;
  const res = await fetch(`${c.url}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`partner corpus ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T[];
}

/** Pages through a query 1,000 rows at a time, a few pages in flight. */
async function all<T>(path: string, max = 400_000): Promise<T[]> {
  const out: T[] = [];
  const PAR = 6;
  for (let from = 0; from < max; from += 1000 * PAR) {
    const pages = await Promise.all(Array.from({ length: PAR }, (_, i) => rest<T>(path, [from + i * 1000, from + i * 1000 + 999])));
    for (const p of pages) out.push(...p);
    if (pages.some((p) => p.length < 1000)) break;
  }
  return out;
}

export async function loadExternalPayload(ticker: string): Promise<IrPayload | null> {
  const t = encodeURIComponent(ticker);
  const [defs, values] = await Promise.all([
    all<ExtDef>(`kpi_definitions?ticker=eq.${t}&select=kpi_id,name,category,unit,parent_id,sums_to_parent,sort&order=kpi_id`),
    all<ExtValue>(`kpi_values?ticker=eq.${t}&select=kpi_id,period_kind,period_end,fiscal_label,value,source_id,anchor,derived&order=kpi_id,period_kind,period_end`),
  ]);
  if (!values.length) return null;
  const docs = await all<ExtDoc>(`ir_documents?ticker=eq.${t}&select=id,url,title,doc_type,published&order=id`);
  return buildExternalPayload(ticker, defs, values, docs);
}

export async function loadExternalDoc(id: string): Promise<ExtDoc | null> {
  const rows = await rest<ExtDoc>(`ir_documents?id=eq.${encodeURIComponent(id)}&select=id,url,title,doc_type,published,ext,storage_path,text_path,pages&limit=1`);
  return rows[0] ?? null;
}
