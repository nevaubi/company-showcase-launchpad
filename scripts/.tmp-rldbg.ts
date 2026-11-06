import { readCachedFiling } from "@/lib/jobs/jobs.server";
import { loadDataset } from "@/lib/reports/inputs.server";
import { htmlToBlocks, splitSections } from "@/lib/redline/extract";
const [t, form] = [process.argv[2], process.argv[3] as "10-K" | "10-Q"];
const d = await loadDataset(t);
const f = d!.filings.filter((x) => x.form === form && x.doc).sort((a, b) => b.filed.localeCompare(a.filed))[0];
const c = await readCachedFiling(f.accn, f.doc);
const b = htmlToBlocks(c!.html);

console.log(f.accn, f.doc, "blocks", b.length);
b.forEach((x, i) => { if (/^\s*(part\s+i|item\s*\d)/i.test(x.text) && x.text.length < 200) console.log(i, x.heading ? "H" : " ", x.text.slice(0, 110)); });
b.slice(0, 0).forEach((x, i) => console.log(20 + i, x.heading ? "H" : " ", x.text.slice(0, 100)));
if (process.argv[4]) b.forEach((x, i) => { if (x.heading && x.text.length < 90) console.log(i, x.text.slice(0, 90)); });
console.log(splitSections(b, form).map((s) => `${s.key}:${s.blocks.length}`).join(" "));
process.exit(0);
