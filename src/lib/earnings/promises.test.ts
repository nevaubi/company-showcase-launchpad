import { describe, expect, it } from "vitest";
import { credibility, vetPromises, type CallText, type RawPromise } from "./promises";
import { buildAlerts, unreadCount } from "../alerts/core";

const calls: CallText[] = [
  { url: "u1", date: "2026-01-30", quarter: "Q4 2025", text: "We expect gross margin to reach 45% by the end of next year. We will open three new plants." },
  { url: "u2", date: "2026-10-30", quarter: "Q3 2026", text: "Gross margin came in at 45.2%, achieving the target we set." },
];
const base: RawPromise = { quote: "We expect gross margin to reach 45% by the end of next year", callDate: "2026-01-30", category: "margin", summary: "", deadline: null, status: "kept", outcomeQuote: "Gross margin came in at 45.2%, achieving the target", outcomeCallDate: "2026-10-30", note: "" };

describe("vetPromises", () => {
  it("keeps a kept promise when both quotes are verbatim", () => {
    const [p] = vetPromises([base], calls);
    expect(p.status).toBe("kept");
    expect(p.outcomeUrl).toBe("u2");
  });
  it("drops a promise whose quote is not in the call", () => {
    expect(vetPromises([{ ...base, quote: "We expect revenue to double next year for sure" }], calls)).toHaveLength(0);
  });
  it("downgrades to pending when the outcome quote is not verbatim", () => {
    expect(vetPromises([{ ...base, outcomeQuote: "Gross margin was a record 47% this quarter" }], calls)[0].status).toBe("pending");
  });
  it("downgrades when the outcome comes from the same or an earlier call", () => {
    expect(vetPromises([{ ...base, outcomeQuote: "We will open three new plants.", outcomeCallDate: "2026-01-30" }], calls)[0].status).toBe("pending");
  });
});

describe("credibility", () => {
  it("is null with fewer than 3 graded", () => {
    expect(credibility([{ status: "kept" }, { status: "missed" }, { status: "pending" }]).score).toBeNull();
  });
  it("counts partial as half", () => {
    expect(credibility([{ status: "kept" }, { status: "missed" }, { status: "partial" }, { status: "kept" }]).score).toBe(0.625);
  });
});

describe("buildAlerts", () => {
  const empty = { filings: [], insiders: [], links: [], alt: [], ideas: [] };
  it("only alerts on watchlist tickers since the cutoff, and groups a Form 4 into one alert", () => {
    const ins = (seq: number, ticker = "AAPL") => ({ accn: "a1", seq, ticker, owner: "Tim", role: "CEO", code: "S", shares: 100, price: 200, plan_10b5: true, trade_date: "2026-11-01", doc: "d", filed: "2026-11-02", discovered_at: "2026-11-02T10:00:00Z" });
    const a = buildAlerts({ ...empty, tickers: ["AAPL"], since: "2026-10-01", insiders: [ins(1), ins(2), { ...ins(3, "MSFT"), accn: "a2" }] });
    expect(a).toHaveLength(1);
    expect(a[0].title).toBe("Tim (CEO) sold $40K");
  });
  it("skips non-material forms", () => {
    const f = { accn: "x", ticker: "AAPL", form: "S-8", filed: "2026-11-01", doc: "d", description: null, items: null, discovered_at: "2026-11-01T00:00:00Z" };
    expect(buildAlerts({ ...empty, tickers: ["AAPL"], since: "2026-10-01", filings: [f] })).toHaveLength(0);
  });
  it("counts unread after last seen", () => {
    expect(unreadCount([{ at: "2026-11-02" }, { at: "2026-10-01" }], "2026-10-15")).toBe(1);
  });
});

describe("alert noise", () => {
  it("ignores Federal Register regulatory notices but keeps ownership filings", () => {
    const row = (dataset: string) => ({ uid: dataset, ticker: "TSLA", dataset, title: "x", date: "2026-11-01", source_url: null, created_at: "2026-11-05T00:00:00Z" });
    const a = buildAlerts({ tickers: ["TSLA"], since: "2026-10-01", filings: [], insiders: [], links: [], ideas: [], alt: [row("regulatory"), row("ownership")] });
    expect(a.map((x) => x.detail)).toEqual(["ownership"]);
  });
});

describe("supply alerts", () => {
  it("ignores links re-read today from an old filing", () => {
    const l = { id: "1", ticker: "NVDA", counterparty: "TSMC", relation: "supplier", detail: "", accn: "a", doc: "d", form: "10-K", filed: "2026-02-20", created_at: "2026-11-05T00:00:00Z", is_current: true };
    expect(buildAlerts({ tickers: ["NVDA"], since: "2026-10-06", filings: [], insiders: [], alt: [], ideas: [], links: [l] })).toHaveLength(0);
  });
});
