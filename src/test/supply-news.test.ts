import { expect, it } from "vitest";
import { supplyNewsCandidate, supplyNewsDomains } from "../../scripts/lib/supply-news";

it("accepts a dated issuer or newswire article and removes tracking without losing the document id", () => {
  const domains = supplyNewsDomains("https://www.apple.com", "invalid-url");
  const now = Date.UTC(2026, 10, 27);
  const result = (url: string, publishedAt?: string) => supplyNewsCandidate({ url, publishedAt }, domains, now);
  expect(result("https://investor.apple.com/news?id=5&utm_source=feed#top", "2026-11-01")).toEqual({
    url: "https://investor.apple.com/news?id=5", filed: "2026-11-01",
  });
  expect(result("https://apple.com.unverified.example/news", "2026-11-01")).toBeNull();
  expect(result("https://reuters.com/news", "2026-11-28")).toBeNull();
  expect(result("https://reuters.com/news", "2024-01-01")).toBeNull();
  expect(result("https://reuters.com/news")).toBeNull();
});
