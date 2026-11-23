import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
const { altKeysFor } = await import("./query");

const client = (universe: () => Promise<unknown>) => ({ ensureQueryData: universe }) as unknown as QueryClient;

describe("altKeysFor", () => {
  it("fails the read when the universe cannot be loaded, instead of hiding one-word companies' rows", async () => {
    await expect(altKeysFor(client(() => Promise.reject(new Error("offline"))))).rejects.toThrow("offline");
  });

  it("judges with the universe's legal names and refuses a core two covered companies share", async () => {
    const keys = await altKeysFor(client(async () => ({ companies: [{ ticker: "BA", name: "BOEING CO" }, { ticker: "FBP", name: "FIRST BANCORP /PR/" }, { ticker: "FBNC", name: "FIRST BANCORP /NC/" }] })));
    expect(keys("BA")?.forms.get("boeing")?.has("co")).toBe(true);
    expect(keys("FBP")?.shared?.has("first bancorp")).toBe(true);
    expect(keys("ZZZZ")).toBeNull();
  });
});
