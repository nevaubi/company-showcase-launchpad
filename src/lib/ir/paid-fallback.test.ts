import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The lane and paid reader are stubbed: no OpenAI or database call is made.
const lane = vi.fn();
const paid = vi.fn();
let paidOn = false;
vi.mock("@/lib/ir/openai-lane.server", () => ({
  laneStructured: (o: unknown) => lane(o),
  paidStructured: (o: unknown) => paid(o),
  paidFallback: () => paidOn,
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const req = { model: "gpt-5.4-mini", name: "t", instructions: "i", input: "x", schema: {} };

describe("worker free-only reading with the owner's paid OpenAI key behind it", () => {
  beforeEach(() => {
    process.env["IR_FREE_ONLY"] = "1";
    lane.mockReset();
    paid.mockReset();
    paidOn = false;
  });
  afterEach(() => {
    delete process.env["IR_FREE_ONLY"];
  });

  it("reads on the free allowance while it lasts and never touches the paid key", async () => {
    const { openaiStructured } = await import("@/lib/openai.server");
    paidOn = true;
    lane.mockResolvedValue({ data: { ok: 1 }, usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0 }, model: "gpt-5.4-mini" });
    await expect(openaiStructured(req)).resolves.toMatchObject({ data: { ok: 1 } });
    expect(paid).not.toHaveBeenCalled();
  });

  it("continues on the paid key with the same model once the free allowance is spent", async () => {
    const { openaiStructured } = await import("@/lib/openai.server");
    paidOn = true;
    lane.mockResolvedValue(null);
    paid.mockResolvedValue({ data: { ok: 2 }, usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0 }, model: "gpt-5.4-mini" });
    await expect(openaiStructured(req)).resolves.toMatchObject({ data: { ok: 2 } });
    expect(paid.mock.calls[0][0]).toMatchObject({ model: "gpt-5.4-mini" });
  });

  it("without the paid switch a spent allowance still stops the run on quota", async () => {
    const { openaiStructured } = await import("@/lib/openai.server");
    lane.mockResolvedValue(null);
    await expect(openaiStructured(req)).rejects.toMatchObject({ kind: "quota" });
    expect(paid).not.toHaveBeenCalled();
  });
});
