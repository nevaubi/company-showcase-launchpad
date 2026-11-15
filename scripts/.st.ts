import { sb } from "./lib/supa";
const t = process.argv[2];
const { data } = await sb.from("ir_documents").select("id,title,kind,ext,pages,extract_status,extracted_at,rendition_path,updated_at:extracted_at").eq("ticker", t).limit(3000);
const rows = data ?? [];
const by: Record<string, number> = {};
for (const r of rows) { const k = (r.extract_status ?? "null").replace(/\(.*\)/, "()").slice(0,30); by[k] = (by[k] ?? 0) + 1; }
console.log(rows.length, JSON.stringify(by));
console.log("working:", rows.filter(r => r.extract_status === "working").map(r => r.title.slice(0, 60)));
const claim = rows.filter(r => r.extract_status === null && r.extracted_at === null && (r.ext === "htm" || r.ext === "html" || (r.rendition_path ?? "").includes("html")) && ["press-release","supplement","presentation","data","other"].includes(r.kind) && (r.pages == null || r.pages <= 90));
console.log("claimable:", claim.length);
process.exit(0);
