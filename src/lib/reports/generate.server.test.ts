import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { hydrateDataset } from "@/lib/financials/dataset";
import { generateReportContent } from "./generate.server";
import { DEFAULT_OPTIONS } from "./kinds";

const stubs = vi.hoisted(() => ({
  direct: vi.fn(), gateway: vi.fn(),
  draft: { title: "Company profile", subtitle: "Business overview", sections: [{ id: "summary", paragraphs: [{ text: "The annual filing describes the company's business.", factIds: ["F1"] }], bullets: [] }] },
}));
vi.mock("@/lib/ai.server", () => ({ MODEL: "openai/gpt-6-astra", structured: stubs.gateway }));
vi.mock("@/lib/openai.server", () => ({ openaiStructured: stubs.direct }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const inputs = {
  data: hydrateDataset(JSON.parse(readFileSync("src/test/fixtures/companies/AAPL.json", "utf8"))),
  today: "2026-11-27", estimates: null, price: null, promises: null, reactions: null, coverage: null,
};
it("records the worker's returned model, including a routed fallback", async () => {
  vi.stubEnv("IR_FREE_ONLY", "1");
  stubs.direct.mockResolvedValue({ data: stubs.draft, model: "worker-model-returned-by-provider", usage: {} });
  const out = await generateReportContent("primer", DEFAULT_OPTIONS, inputs, null);
  expect(out.model).toBe("worker-model-returned-by-provider");
  expect(stubs.gateway).not.toHaveBeenCalled();
});
it("retains the native gateway report model on an app request", async () => {
  vi.stubEnv("IR_FREE_ONLY", "");
  stubs.gateway.mockResolvedValue(stubs.draft);
  const out = await generateReportContent("primer", DEFAULT_OPTIONS, inputs, null);
  expect(out.model).toBe("openai/gpt-6-astra");
  expect(stubs.direct).not.toHaveBeenCalled();
});
