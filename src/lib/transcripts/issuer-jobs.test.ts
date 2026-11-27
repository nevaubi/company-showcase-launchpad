import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  calls: vi.fn(),
  retiredJob: "web:NOT_A_LISTING",
  deleted: vi.fn(),
  web: vi.fn(),
  commitments: vi.fn(),
  mirror: vi.fn(),
  analyze: vi.fn(),
  keys: vi.fn(),
  updates: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/transcripts.server", () => ({
  DEMAND_PREFIX: "web:",
  PROMISE_PREFIX: "model:",
  listCalls: mock.calls,
  refreshWebCalls: mock.web,
}));
vi.mock("@/lib/earnings/promises.server", () => ({ analyzePromises: mock.commitments }));
vi.mock("./issuer-mirror.server", () => ({
  analyzeIssuerSlice: mock.analyze,
  mirrorIssuerSlice: mock.mirror,
}));
vi.mock("./issuer-archive.server", () => ({ issuerKeys: mock.keys }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => {
        const q = {
          like: () => q,
          or: () => q,
          order: () => q,
          limit: () => q,
          maybeSingle: async () => ({ data: { job: mock.retiredJob }, error: null }),
        };
        return q;
      },
      delete: () => {
        const q = {
          eq: (field: string, value: string) => {
            mock.deleted(field, value);
            return q;
          },
        };
        return q;
      },
      upsert: () => ({ abortSignal: async () => ({ error: null }) }),
      update: (values: Record<string, unknown>) => {
        mock.updates.push(values);
        const q = {
          eq: () => q,
          or: () => q,
          select: () => q,
          abortSignal: () => q,
          maybeSingle: async () => ({ data: { cursor: 0 }, error: null }),
        };
        return q;
      },
    }),
  },
}));
import { nextTranscriptDemand, scheduledCallArchive } from "./issuer-jobs.server";

describe("managed earnings-call refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.updates.length = 0;
    mock.keys.mockResolvedValue(new Set(["issuer-index:v1:C", "issuer-index:v1:JPM"]));
    mock.analyze.mockResolvedValue({ processed: 1, remaining: 4 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("retires an unsupported symbol once without a provider request or a six-hour failure lease", async () => {
    expect(await nextTranscriptDemand("web:")).toBe(false);
    expect(mock.deleted).toHaveBeenCalledWith("job", mock.retiredJob);
    expect(mock.deleted).toHaveBeenCalledWith("lease_until", expect.any(String));
    expect(mock.updates).toHaveLength(1);
    expect(mock.web).not.toHaveBeenCalled();
    expect(mock.commitments).not.toHaveBeenCalled();
  });
  it.each(["09:22", "09:26"])(
    "keeps the former external-provider slot %s local and advances across issuers",
    async (time) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-27T" + time + ":00Z"));
      const result = await scheduledCallArchive();
      expect(result).toMatchObject({ ok: true, items: 1, detail: { ticker: "JPM", remaining: 4 } });
      expect(mock.analyze).toHaveBeenCalledWith(
        expect.objectContaining({ ticker: "JPM" }),
        1,
        expect.any(AbortSignal),
      );
      expect(mock.updates[1]).toMatchObject({ cursor: 1, lease_until: null });
      for (const operation of [mock.calls, mock.web, mock.commitments, mock.mirror])
        expect(operation).not.toHaveBeenCalled();
    },
  );
  it("cuts off a slow local query and releases the short lease", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
      ms === 2700 ? controller.signal : new AbortController().signal,
    );
    mock.analyze.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("Timeout", "AbortError");
    });
    expect(await scheduledCallArchive()).toMatchObject({
      ok: true,
      items: 0,
      detail: { cut: true },
    });
    expect(mock.updates[1]).toMatchObject({ cursor: 1, lease_until: null });
  });
});
