import { COVERAGE } from "@/lib/coverage";
import { sb } from "./supa";

const EXTRACTABLE_KINDS = ["press-release", "supplement", "presentation", "data", "other"];
const VISION_PDF_KINDS = ["press-release", "supplement", "other", "data"];

async function waitingCount(ticker: string): Promise<number> {
  const extract = sb
    .from("ir_documents")
    .select("id", { count: "exact", head: true })
    .eq("ticker", ticker)
    .is("extracted_at", null)
    .is("extract_status", null)
    .or("ext.in.(htm,html),rendition_path.like.%html")
    .in("kind", EXTRACTABLE_KINDS)
    .or("pages.is.null,pages.lte.90");
  const vision = sb
    .from("ir_documents")
    .select("id", { count: "exact", head: true })
    .eq("ticker", ticker)
    .is("vision_status", null)
    .not("path", "is", null)
    .or(
      `and(kind.eq.image,bytes.gt.40000),and(kind.eq.presentation,ext.eq.pdf),and(ext.eq.pdf,kind.in.(${VISION_PDF_KINDS.join(",")}))`,
    );
  const [{ count: files }, { count: slides }] = await Promise.all([extract, vision]);
  return (files ?? 0) + (slides ?? 0);
}

const rows = await Promise.all(COVERAGE.map((c) => c.ticker)).then((ts) =>
  Promise.all(ts.map(async (t) => [t, await waitingCount(t)] as const)),
);
const withWork = rows.filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1]);
console.log("companies with real work:", withWork.length, "of", rows.length);
console.log("total waiting:", withWork.reduce((s, [, n]) => s + n, 0));
console.log("smallest 8:", withWork.slice(0, 8).map(([t, n]) => `${t}=${n}`).join(" "));
console.log("biggest 8:", withWork.slice(-8).map(([t, n]) => `${t}=${n}`).join(" "));

const { data: skipped } = await sb
  .from("ir_documents")
  .select("extract_status,vision_status")
  .or("extract_status.like.skipped:*,vision_status.like.skipped:*")
  .limit(1);
console.log("skipped rows exist:", !!skipped?.length);
