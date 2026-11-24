import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SupplyNetwork } from "./supply-network";
import type { GraphNode, NodeRisk, Relation, SupplyLink } from "@/lib/supply/core";

const link = (share: number | null): SupplyLink => ({ id: String(Math.random()), ticker: "NVDA", counterparty: "X", counterparty_ticker: null, counterparty_domain: null, relation: "supplier", detail: "", share_pct: share, quote: "q", accn: "a", doc: "d", form: "10-K", filed: "2026-02-01" });
const node = (relation: Relation, name: string, share: number | null = null): GraphNode => ({ key: `${relation}:${name}`, name, ticker: null, domain: null, relation, links: [link(share)] });
const focus: GraphNode = { key: "focus", name: "NVIDIA", ticker: "NVDA", domain: null, relation: "focus", links: [] };
const ALL = new Set<Relation>(["customer", "supplier", "partner", "competitor"]);
const risk = (p: Partial<NodeRisk>): NodeRisk => ({ singleSource: false, dependency: false, concentrated: false, hotspots: [], regions: [], dollars: null, nature: "trade", ...p });

/* jsdom has no layout: give the container a width and a ResizeObserver so the wide layout renders */
const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterAll(() => {
  if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
  vi.unstubAllGlobals();
});

describe("SupplyNetwork", () => {
  const graph = [node("supplier", "TSMC"), node("customer", "Microsoft", 19), node("partner", "Arm"), node("competitor", "AMD")];
  const props = { focus, graph, hop2: [], visible: ALL, selected: null as string | null, onSelect: () => {}, overlay: "none" as const, risks: { "customer:Microsoft": risk({ dollars: 40e9 }), "supplier:TSMC": risk({ singleSource: true }) }, impacts: null };

  it("groups cards by relation, names each one fully, and opens the evidence on click", () => {
    const onSelect = vi.fn();
    render(<SupplyNetwork {...props} onSelect={onSelect} />);
    const suppliers = screen.getByRole("group", { name: /^Suppliers: 1$/ });
    const tsmc = within(suppliers).getByRole("button", { name: /TSMC, supplier, single source\. Open the filing evidence\./ });
    expect(within(screen.getByRole("group", { name: /^Customers/ })).getByRole("button", { name: /Microsoft, customer, 19% share/ })).toBeInTheDocument();
    fireEvent.click(tsmc);
    expect(onSelect).toHaveBeenCalledWith("supplier:TSMC");
  });

  it("marks the selected card as pressed", () => {
    render(<SupplyNetwork {...props} selected="competitor:AMD" />);
    expect(screen.getByRole("button", { name: /^AMD, competitor/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^TSMC, supplier/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("draws every name: a long list is never cut behind a show-more", () => {
    const many = Array.from({ length: 20 }, (_, i) => node("supplier", `S${String(i).padStart(2, "0")}`, 30 - i));
    render(<SupplyNetwork {...props} graph={[...many, node("customer", "Microsoft", 19)]} />);
    expect(screen.getAllByRole("button", { name: /, supplier.*Open the filing evidence/ })).toHaveLength(20);
    expect(screen.queryByRole("button", { name: /more suppliers/i })).toBeNull();
  });

  it("dims the names outside what is isolated, says so, and keeps them usable", () => {
    const onSelect = vi.fn();
    render(<SupplyNetwork {...props} onSelect={onSelect} isolate={new Set(["supplier:TSMC"])} isolateLabel="TSMC" isolatedKey="supplier:TSMC" onIsolate={() => {}} />);
    const tsmc = screen.getByRole("button", { name: /^TSMC, supplier/ }), amd = screen.getByRole("button", { name: /^AMD, competitor/ });
    expect(tsmc.getAttribute("aria-label")).not.toMatch(/outside what is isolated/);
    expect(amd.getAttribute("aria-label")).toMatch(/outside what is isolated/);
    expect(tsmc.closest("[data-card]")).not.toHaveAttribute("data-dim");
    expect(amd.closest("[data-card]")).toHaveAttribute("data-dim");
    fireEvent.click(amd);
    expect(onSelect).toHaveBeenCalledWith("competitor:AMD");
    expect(screen.getByText(/Isolated: TSMC/)).toBeInTheDocument();
  });

  it("a card's isolate button asks for that name, and shows as pressed while it is the one isolated", () => {
    const onIsolate = vi.fn();
    const { rerender } = render(<SupplyNetwork {...props} onIsolate={onIsolate} />);
    const button = screen.getByRole("button", { name: "Isolate TSMC" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(onIsolate).toHaveBeenCalledWith({ kind: "node", key: "supplier:TSMC" });
    rerender(<SupplyNetwork {...props} onIsolate={onIsolate} isolate={new Set(["supplier:TSMC"])} isolatedKey="supplier:TSMC" />);
    expect(screen.getByRole("button", { name: "Stop isolating TSMC" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a group's isolate button asks for that relation", () => {
    const onIsolate = vi.fn();
    const { rerender } = render(<SupplyNetwork {...props} onIsolate={onIsolate} />);
    fireEvent.click(screen.getByRole("button", { name: "Isolate competitors" }));
    expect(onIsolate).toHaveBeenCalledWith({ kind: "relation", relation: "competitor" });
    rerender(<SupplyNetwork {...props} onIsolate={onIsolate} isolate={new Set(["competitor:AMD"])} isolatedRelation="competitor" />);
    expect(screen.getByRole("button", { name: "Stop isolating competitors" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers no isolate buttons when the page does not handle isolation", () => {
    render(<SupplyNetwork {...props} />);
    expect(screen.queryByRole("button", { name: /^Isolate/ })).toBeNull();
  });

  it("flags cards the overlay hits without relying on colour alone", () => {
    render(<SupplyNetwork {...props} overlay="single" />);
    expect(screen.getByRole("button", { name: /TSMC, supplier, single source, flagged by the overlay/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Microsoft, customer/ }).getAttribute("aria-label")).not.toMatch(/flagged/);
  });

  it("shows the shock only on supplier and customer names, not on a partner or competitor that shares the ticker", () => {
    const g = [{ ...node("supplier", "HPE"), ticker: "HPE", key: "supplier:HPE" }, { ...node("partner", "HPE"), ticker: "HPE", key: "partner:HPE" }, { ...node("competitor", "HPE"), ticker: "HPE", key: "competitor:HPE" }];
    const impacts = new Map([["HPE", { key: "HPE", name: "HPE", ticker: "HPE", hop: 1, channel: "lost sales" as const, revenuePct: 0.1, dollars: null, severity: "high" as const, path: [], link: g[0].links[0] }]]);
    render(<SupplyNetwork {...props} graph={g} risks={{}} impacts={impacts} />);
    expect(screen.getByRole("button", { name: /^HPE, supplier.*shock: high impact/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^HPE, partner.*not reached by the shock/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^HPE, competitor.*not reached by the shock/ })).toBeInTheDocument();
  });
});
