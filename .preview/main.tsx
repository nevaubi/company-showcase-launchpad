import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import { InsiderActivity } from "@/components/insiders/insider-activity";
import { SupplySankey } from "@/components/supply/supply-sankey";
import { focusGraph, type SupplyLink } from "@/lib/supply/core";
import type { Bar, InsiderTrade } from "@/lib/financials/types";
import type { MarketTrade } from "@/lib/insiders/activity";
import nke from "./nke.json";
import rtx from "./rtx.json";
import nkeLogo from "../public/logos/NKE.svg?inline";
import rtxLogo from "../public/logos/RTX.svg?inline";
import baLogo from "../public/logos/BA.svg?inline";
import atiLogo from "../public/logos/ATI.svg?inline";
import hwmLogo from "../public/logos/HWM.jpg?inline";

// The app serves logos from /logos; this standalone page has no server, so point those images at inlined copies.
const LOGOS: Record<string, string> = { NKE: nkeLogo, RTX: rtxLogo, BA: baLogo, ATI: atiLogo, HWM: hwmLogo };
const fix = (img: HTMLImageElement) => {
  const m = img.getAttribute("src")?.match(/^\/logos\/([A-Z.]+)\.(svg|png|jpg)$/);
  if (m && LOGOS[m[1]]) img.src = LOGOS[m[1]];
};
new MutationObserver((muts) => muts.forEach((mu) => mu.addedNodes.forEach((n) => n instanceof HTMLElement && (n instanceof HTMLImageElement ? fix(n) : n.querySelectorAll("img").forEach(fix))))).observe(document.documentElement, { childList: true, subtree: true });

function App() {
  const [trade, setTrade] = useState<MarketTrade | null>(null);
  const [party, setParty] = useState<string | null>(null);
  const links = rtx.links as unknown as SupplyLink[];
  const graph = useMemo(() => focusGraph("RTX", links, rtx.names), [links]);
  const picked = graph.find((n) => n.key === party);
  const note: React.CSSProperties = { margin: "10px 2px 0", fontSize: 13, color: "var(--muted-foreground)" };
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px 80px", display: "grid", gap: 36 }}>
      <p style={{ margin: 0, border: "1px dashed var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--muted-foreground)" }}>
        Preview of the real components from pull requests 3 and 4. Nothing here is deployed. Data is a snapshot: Nike insider trades from your bundled Form 4 file with real daily closes, and RTX supply records from your database.
      </p>
      <section>
        <h1 style={{ fontSize: 20, margin: "0 0 12px", fontWeight: 600 }}>1. Insider activity (pull request 3)</h1>
        <InsiderActivity ticker="NKE" insiders={nke.insiders as unknown as InsiderTrade[]} bars={nke.bars as unknown as Bar[]} onOpen={setTrade} />
        <p style={note}>{trade ? `In the app this opens the Form 4 for ${trade.owner}, filed ${trade.filed} (accession ${trade.accn}).` : "Click a trade dot: in the app it opens that Form 4."}</p>
      </section>
      <section>
        <h1 style={{ fontSize: 20, margin: "0 0 12px", fontWeight: 600 }}>2. Supply chain flow (pull request 4)</h1>
        <div style={{ height: 760, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <SupplySankey ticker="RTX" focusName="RTX" graph={graph} revenue={rtx.revenue} selected={party} onSelect={setParty} />
        </div>
        <p style={note}>
          {picked ? (
            <>
              In the app this opens the evidence tab. The sentence behind {picked.name}: “{picked.links[0].quote}” ({picked.links[0].form}, filed {picked.links[0].filed})
            </>
          ) : (
            "Click a row: in the app it opens the filing sentence behind that relationship."
          )}
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
