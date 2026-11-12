import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SourceProvider } from "@/components/source/source-context";
import { publicSlice } from "@/lib/reports/public";
import type { ReportContent } from "@/lib/reports/types";

// The public panel links to sign-up; the router isn't mounted in this test.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const { ReportDocument } = await import("./report-document");
const { PublicSourcePanel } = await import("./public-source-panel");

const content: ReportContent = {
  version: 1,
  ticker: "MMS",
  name: "Maximus",
  kind: "primer",
  title: "Maximus: Margin Resilience, Growth Discount",
  subtitle: "Federal and clinical services underpin the mix shift.",
  asOf: "2026-11-12",
  priceAsOf: "2026-11-11",
  dataVersion: "v1",
  generatedAt: "2026-11-12",
  model: "test",
  options: {
    length: "standard",
    audience: "internal",
    stance: "balanced",
    sections: [],
    focus: "",
  },
  facts: [
    {
      id: "rev",
      area: "segments",
      text: "U.S. Federal Services revenue for the fiscal year ended 2025-09-30: $3.07B.",
      ref: {
        kind: "sec",
        label: "Federal revenue",
        src: {
          accn: "0001032220-25-000053",
          concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
          start: "2024-10-01",
          end: "2025-09-30",
          value: 3.07e9,
        },
      },
    },
    {
      id: "ceo",
      area: "insiders",
      text: "2026-02-10: Bruce Caswell (CEO &amp; President, Director) bought 1,691 shares at $78.77.",
      ref: {
        kind: "filing",
        accn: "0001193125-26-046686",
        doc: "form4.xml",
        form: "4",
        filed: "2026-02-11",
        label: "Form 4",
      },
    },
    {
      id: "hidden",
      area: "annual",
      text: "FY2025 free cash flow: $366M.",
      ref: {
        kind: "sec",
        label: "FCF",
        src: {
          accn: "0001032220-25-000053",
          concept: "us-gaap:NetCashProvidedByUsedInOperatingActivities",
          end: "2025-09-30",
          value: 3.66e8,
        },
      },
    },
  ],
  tables: [],
  charts: [],
  sections: [
    {
      id: "summary",
      title: "Investment summary",
      paragraphs: [],
      bullets: [{ text: "Federal services are the largest segment.", factIds: ["rev"] }],
      tables: [],
    },
    {
      id: "business",
      title: "Business overview",
      paragraphs: [{ text: "The chief executive bought shares.", factIds: ["ceo"] }],
      bullets: [],
      tables: [],
    },
    {
      id: "financials",
      title: "Financial profile",
      paragraphs: [{ text: "Free cash flow fell below the prior year.", factIds: ["hidden"] }],
      bullets: [],
      tables: [],
    },
  ],
  qa: { claims: 3, citedClaims: 3, numbers: 103, verifiedNumbers: 102, removed: [] },
};

function page() {
  const cut = publicSlice(content);
  return render(
    <SourceProvider>
      <ReportDocument
        content={cut.content}
        brand={{
          branding: { footer: "Public preview · filedunder.ai", signature: false },
          logo: null,
          firmName: null,
          preparedBy: null,
        }}
      />
      <PublicSourcePanel ciks={{ MMS: "0001032220" }} />
    </SourceProvider>,
  );
}

describe("public primer page", () => {
  it("renders the free sections outside the app shell and leaves the locked ones out", () => {
    page();
    expect(screen.getByText("Maximus: Margin Resilience, Growth Discount")).toBeInTheDocument();
    expect(screen.getByText("102 of 103 figures matched to their sources")).toBeInTheDocument();
    expect(screen.getByText("Investment summary")).toBeInTheDocument();
    expect(screen.getByText("Business overview")).toBeInTheDocument();
    expect(screen.queryByText("Financial profile")).not.toBeInTheDocument();
    expect(screen.queryByText(/Free cash flow fell/)).not.toBeInTheDocument();
    expect(screen.getByText("Public preview · filedunder.ai")).toBeInTheDocument();
    expect(screen.queryByText(/not for distribution/)).not.toBeInTheDocument();
  });

  it("shows stored XML entities as plain characters", () => {
    page();
    expect(screen.getAllByText(/CEO & President, Director/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/&amp;/)).not.toBeInTheDocument();
  });

  it("opens a citation as source details with a link to the filing on SEC EDGAR", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /^Source 1:/ }));
    const panel = screen.getByRole("dialog");
    expect(
      within(panel).getByText("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Oct 1, 2024 to Sep 30, 2025")).toBeInTheDocument();
    const link = within(panel).getByRole("link", { name: /0001032220-25-000053/ });
    expect(link).toHaveAttribute(
      "href",
      "https://www.sec.gov/Archives/edgar/data/1032220/000103222025000053/",
    );
    expect(within(panel).getByRole("link", { name: "Join the waitlist" })).toHaveAttribute(
      "href",
      "/auth",
    );
  });
});
