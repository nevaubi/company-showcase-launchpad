import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { SourceProvider } from "@/components/source/source-context";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { VALID_SPECS } from "@/lib/research/fixtures/views";
import { parseViewSpec } from "@/lib/research/view-spec";
import { ViewRenderer } from "./view";

const render = (ui: ReactElement) => rtlRender(<SourceProvider>{ui}</SourceProvider>);

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg data-testid="mermaid-svg"><text>TSMC</text></svg>' })),
  },
}));

beforeAll(() => {
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("ViewRenderer", () => {
  it.each(Object.keys(VALID_SPECS))("renders %s without errors and reports ok", async (key) => {
    const r = parseViewSpec(VALID_SPECS[key]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const status = vi.fn();
    const { container } = render(<ViewRenderer spec={r.spec} onStatus={status} renderFile={() => <span>file</span>} />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(status).toHaveBeenLastCalledWith({ ok: true });
    expect(container.textContent).not.toMatch(/could not be drawn/);
  });

  it("shows titles, subtitles, sources and a data-table toggle", () => {
    const r = parseViewSpec({ ...(VALID_SPECS.hbar as object), title: "Margin rank", subtitle: "Operating margin, TTM", source: "SEC filings" });
    if (!r.ok) throw new Error(r.error);
    render(<ViewRenderer spec={r.spec} />);
    expect(screen.getByText("Margin rank")).toBeInTheDocument();
    expect(screen.getByText("Operating margin, TTM")).toBeInTheDocument();
    expect(screen.getByText("Source: SEC filings")).toBeInTheDocument();
    expect(screen.getByText("25.0%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Data/ }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Value" })).toBeInTheDocument();
  });

  it("renders dashboard sections and switches tabs", () => {
    const r = parseViewSpec(VALID_SPECS.dashboardTabs);
    if (!r.ok) throw new Error(r.error);
    render(<ViewRenderer spec={r.spec} />);
    expect(screen.getByText("g")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Value" }));
    expect(screen.getByText("v")).toBeInTheDocument();
  });

  it("draws mermaid diagrams lazily", async () => {
    const r = parseViewSpec(VALID_SPECS.mermaid);
    if (!r.ok) throw new Error(r.error);
    render(<ViewRenderer spec={r.spec} />);
    expect(await screen.findByTestId("mermaid-svg")).toBeInTheDocument();
  });
});
