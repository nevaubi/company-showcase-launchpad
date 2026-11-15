import { sb } from "./lib/supa";
const t = process.argv[2];
const { data } = await sb.from("ir_documents").select("ext,kind,source,rendition_path,extract_status,vision_status,pages").eq("ticker", t).limit(5000);
const by: Record<string, number> = {};
for (const r of data ?? []) { const k = `${r.source}|${r.ext}|${r.kind}|rend=${r.rendition_path ? "y" : "n"}|x=${(r.extract_status ?? "-").replace(/\(.*\)/, "").slice(0,12)}|v=${(r.vision_status ?? "-").slice(0,12)}`; by[k] = (by[k] ?? 0) + 1; }
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(v).padStart(5), k);
process.exit(0);
