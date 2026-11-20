import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { saveSignals } from "../../scripts/lib/supply-save";

// The fake runs replace_supply_signals the way the database function does: refuse, or replace all at once.
function db(stored: Record<string, unknown>[], fail: string | null = null) {
  const calls: Record<string, unknown>[] = [];
  const f = fakeSupabase(
    { supply_signals: stored },
    {
      rpc: {
        replace_supply_signals: (a) => {
          calls.push(a!);
          if (fail) throw new Error(fail);
          const rows = a!._rows as Record<string, unknown>[];
          f.tables.supply_signals = [...f.tables.supply_signals.filter((r) => !(r.ticker === a!._ticker && r.source_kind === a!._source_kind)), ...rows];
          return rows.length;
        },
      },
    },
  );
  return { f, calls };
}
const row = (ticker: string, source_kind: string, title: string) => ({ ticker, source_kind, kind: "customer", title, quote: title });

describe("supply intel save (review F16)", () => {
  it("replaces one company's signals of one kind in a single call, keeping its other kinds and other companies", async () => {
    const { f, calls } = db([row("AAPL", "10-K", "old"), row("AAPL", "call", "keep"), row("MSFT", "10-K", "other")]);
    const out = await saveSignals(f.client as never, "AAPL", "10-K", [row("AAPL", "10-K", "new 1"), row("AAPL", "10-K", "new 2")]);
    expect(out).toEqual({ stored: 2, via: "rpc" });
    expect(calls).toHaveLength(1);
    expect(f.tables.supply_signals.map((r) => r.title).sort()).toEqual(["keep", "new 1", "new 2", "other"]);
    // no delete or insert outside the function
    expect(f.writes).toEqual([]);
  });
  it("a refused save throws and leaves every stored signal as it was", async () => {
    const { f } = db([row("AAPL", "10-K", "old")]);
    f.client.rpc = async () => ({ data: null, error: { message: "new row violates check constraint" } });
    await expect(saveSignals(f.client as never, "AAPL", "10-K", [row("AAPL", "10-K", "new")])).rejects.toThrow(/save failed: new row violates/);
    expect(f.tables.supply_signals.map((r) => r.title)).toEqual(["old"]);
  });
  it("before the function is deployed, falls back to insert-then-delete, which never loses a stored signal", async () => {
    const { f } = db([{ id: "o1", ...row("AAPL", "10-K", "old") }, { id: "k1", ...row("AAPL", "call", "keep") }]);
    f.client.rpc = async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.replace_supply_signals" } });
    const out = await saveSignals(f.client as never, "AAPL", "10-K", [row("AAPL", "10-K", "new")]);
    expect(out).toMatchObject({ stored: 1, via: "fallback" });
    expect(f.writes.map((w) => w.op)).toEqual(["insert", "delete"]);
  });
  it("an empty answer keeps the stored signals; a row for another company or kind is refused before any call", async () => {
    const { f, calls } = db([row("AAPL", "10-K", "old")]);
    expect(await saveSignals(f.client as never, "AAPL", "10-K", [])).toMatchObject({ stored: 0, via: "none" });
    await expect(saveSignals(f.client as never, "AAPL", "10-K", [row("MSFT", "10-K", "x")])).rejects.toThrow(/save refused/);
    expect(calls).toHaveLength(0);
    expect(f.tables.supply_signals.map((r) => r.title)).toEqual(["old"]);
  });
  it("a short count from the database is a failure", async () => {
    const { f } = db([]);
    f.client.rpc = async () => ({ data: 1, error: null });
    await expect(saveSignals(f.client as never, "AAPL", "10-K", [row("AAPL", "10-K", "a"), row("AAPL", "10-K", "b")])).rejects.toThrow(/stored 1 of 2/);
  });
});
