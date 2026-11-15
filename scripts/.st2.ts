import { sb } from "./lib/supa";
const t = process.argv[2];
const { count: all } = await sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", t);
const { count: left } = await sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", t).is("extract_status", null).is("extracted_at", null).or("ext.in.(htm,html),rendition_path.like.%html").in("kind", ["press-release","supplement","presentation","data","other"]);
console.log(t, "files", all, "tables waiting", left);
process.exit(0);
