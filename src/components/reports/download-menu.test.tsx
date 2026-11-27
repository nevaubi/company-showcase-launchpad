import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DownloadMenu } from "./download-menu";
import type { ReportBrand } from "./report-document";
import type { ReportContent } from "@/lib/reports/types";

const { save, write } = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/export/xlsx-theme", () => ({ downloadBlob: save }));
vi.mock("@/lib/export/report-docx", () => ({ reportToDocx: write }));
vi.mock("@/lib/export/chart-capture", () => ({ captureCharts: () => new Map() }));
vi.mock("@/hooks/use-plan", () => ({ useFeatureGate: () => () => true }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

async function selectWord() {
  fireEvent.keyDown(screen.getByRole("button", { name: /download/i }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /word/i }));
}

const brand: ReportBrand = { logo: null, firmName: "First firm", branding: null, preparedBy: null };
const first = { ticker: "JPM", kind: "memo", asOf: "2026-11-06" } as ReportContent;

it.each(["ticker", "branding"])("discards an in-flight Word export when the %s changes", async (change) => {
  let complete!: (blob: Blob) => void;
  write.mockReturnValueOnce(new Promise<Blob>((resolve) => { complete = resolve; }));
  const nextBlob = new Blob(["current"]);
  write.mockResolvedValueOnce(nextBlob);
  const view = render(<DownloadMenu content={first} brand={brand} />);
  await selectWord();
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  const next = change === "ticker" ? { ...first, ticker: "BAC" } : first;
  const nextBrand = change === "branding" ? { ...brand, firmName: "Second firm" } : brand;
  view.rerender(<DownloadMenu content={next} brand={nextBrand} />);
  await act(async () => { complete(new Blob(["stale"])); });
  expect(save).not.toHaveBeenCalled();
  await selectWord();
  await waitFor(() => expect(save).toHaveBeenCalledWith(nextBlob, `${next.ticker}-memo-2026-11-06.docx`));
  expect(write).toHaveBeenLastCalledWith(next, nextBrand, expect.any(Map));
});
