import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FreshnessView, type FreshnessData } from "@/routes/_authenticated/app.freshness";
import { dataFreshness } from "@/lib/jobs/data-freshness";
import { ownerHolds } from "@/lib/jobs/lane-hold";

const NOW = new Date("2026-11-27T12:30:00Z");

function page(holds: ReadonlyMap<string, string>) {
  // every dataset on time except the vendor collector, silent for a day
  const rows = dataFreshness([], NOW).map((d) => ({ key: d.key, newest: d.key === "vendor_backfill" ? "2026-11-26T12:15:00Z" : NOW.toISOString() }));
  const data = {
    at: NOW.toISOString(),
    datasets: dataFreshness(rows, NOW, holds),
    paused: [],
    providers: [],
    alerts: [],
    stalled: [],
    jobs: [],
    unfinished: null,
    health: { source: "function", error: null, unread: [], partial: [] },
    coverage: [],
  } as unknown as FreshnessData;
  return renderToStaticMarkup(<FreshnessView data={data} />);
}

describe("freshness page: a collector the owner stopped", () => {
  it("is shown as stopped by the owner with the reason, and is not counted late", () => {
    const html = page(ownerHolds([{ job: "vendor-backfill", paused_reason: "owner: hold. Vendor collection stopped at the owner's request (since 2026-11-27)" }]));
    expect(html).toContain("Stopped by owner");
    expect(html).toContain("Vendor collection stopped at the owner&#x27;s request (since 2026-11-27)");
    expect(html).toContain("Every running dataset on time. 1 stopped by owner.");
    expect(html).not.toContain(">Stale<");
  });
  it("is late again as soon as the hold is released", () => {
    const html = page(new Map());
    expect(html).toContain(">Stale<");
    expect(html).toContain("1 dataset late.");
    expect(html).not.toContain("Stopped by owner<");
  });
});
