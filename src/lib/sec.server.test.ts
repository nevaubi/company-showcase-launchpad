import { describe, expect, it, vi } from "vitest";
import { fetchSec, retryAfterMs, SecFetchError } from "./sec.server";

const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 200 ? "ok" : "", { status, headers });

describe("fetchSec backoff", () => {
  it("waits for Retry-After on 429 and then succeeds", async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValueOnce(res(429, { "Retry-After": "1" })).mockResolvedValueOnce(res(200));
    const r = await fetchSec("https://data.sec.gov/x.json", { fetchImpl: f as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms), maxWaitMs: 5000 });
    expect(r.status).toBe(200);
    expect(sleeps).toEqual([1000]);
  });
  it("stops early when the wait would run past the caller's deadline", async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValue(res(429, { "Retry-After": "5" }));
    const err = await fetchSec("https://data.sec.gov/x.json", { fetchImpl: f as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms), maxWaitMs: 10_000, deadline: Date.now() + 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(SecFetchError);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/^SEC EDGAR responded 429 \(run budget spent\)/);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });
  it("a 404 is not retried; a network error is, with a bounded wait", async () => {
    const f404 = vi.fn().mockResolvedValue(res(404));
    await expect(fetchSec("https://www.sec.gov/a", { fetchImpl: f404 as unknown as typeof fetch, sleep: async () => undefined })).rejects.toMatchObject({ status: 404 });
    expect(f404).toHaveBeenCalledTimes(1);
    const sleeps: number[] = [];
    const net = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(res(200));
    await fetchSec("https://www.sec.gov/a", { fetchImpl: net as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms), rand: () => 1 });
    expect(sleeps).toEqual([2000]); // transient 5 s backoff capped by the default 2 s wait
  });
  it("passes a timeout signal on every try", async () => {
    const f = vi.fn().mockResolvedValue(res(200));
    await fetchSec("https://www.sec.gov/a", { fetchImpl: f as unknown as typeof fetch, timeoutMs: 1234 });
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("refuses non-SEC URLs", async () => {
    await expect(fetchSec("https://example.com/")).rejects.toThrow(/Only SEC URLs/);
  });
  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs(new Date(Date.now() + 3000).toUTCString(), Date.now())).toBeGreaterThan(1000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });
});
