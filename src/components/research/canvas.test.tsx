import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Step } from "@/lib/research/loop";
import { canvas } from "@/lib/research/views";

vi.mock("@/lib/browser.functions", () => ({
  browserConfigured: vi.fn(async () => ({ configured: false })),
  browserStatus: vi.fn(async () => ({ runs: [] })),
  browserStop: vi.fn(async () => ({})),
  browserStart: vi.fn(),
  browserFiles: vi.fn(),
}));

const { Canvas } = await import("./canvas");
const { Timeline } = await import("./timeline");

describe("Canvas", () => {
  afterEach(() => act(() => canvas.reset()));

  it("renders views with pin/remove controls and switches tabs", async () => {
    act(() => {
      canvas.addView({ type: "kpis", title: "Snapshot", items: [{ label: "Revenue", value: 96.2e9, unit: "$", delta: 0.12 }] });
      canvas.addView({ type: "table", title: "Peers", columns: ["Ticker", "P/E"], rows: [["NVDA", 48.2]] });
    });
    render(<Canvas onClose={() => {}} />);
    expect(screen.getByText("Snapshot")).toBeInTheDocument();
    expect(screen.getByText("$96.2B")).toBeInTheDocument();
    expect(screen.getByText("+12.0%")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Remove view")[0]);
    expect(screen.queryByText("Snapshot")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Browser/ }));
    expect(await screen.findByText("Web browser not configured")).toBeInTheDocument();
  });
});

describe("Timeline", () => {
  it("shows running rows with live labels, reasoning lines and grouped calls", () => {
    const steps: Step[] = [
      { kind: "think", name: "reasoning", summary: "Check the open gap first", status: "done" },
      { kind: "tool", name: "read_webpage", args: { url: "https://a.com/x" }, summary: "", status: "done", batch: 1, ms: 1200 },
      { kind: "tool", name: "read_webpage", args: { url: "https://b.com/y" }, summary: "", status: "done", batch: 2, ms: 800 },
      { kind: "tool", name: "highlight", args: { target: "Gaps", label: "Open gap" }, why: "Pointing at the open gap at $182", summary: "", status: "running", startedAt: Date.now(), batch: 3 },
    ];
    render(<Timeline steps={steps} />);
    expect(screen.getByText("Check the open gap first")).toBeInTheDocument();
    expect(screen.getByText("Read 2 web pages")).toBeInTheDocument();
    expect(screen.getByText("Highlighting")).toBeInTheDocument();
    expect(screen.getByText("Pointing at the open gap at $182")).toBeInTheDocument();
  });
});
