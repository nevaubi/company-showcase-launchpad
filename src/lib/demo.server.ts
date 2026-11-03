import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Seed content for the shared demo account. Every figure below comes from the
// company's SEC filings or Yahoo Finance closes captured by scripts/ingest.ts.
export async function seedDemoWorkspace(db: SupabaseClient<Database>, userId: string) {
  await db.from("profiles").upsert({ id: userId, display_name: "Demo Analyst", is_demo: true });
  await db.from("watchlist").upsert(
    ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "TSLA"].map((ticker) => ({ user_id: userId, ticker })),
    { onConflict: "user_id,ticker" },
  );

  const theses = [
    {
      ticker: "NVDA",
      title: "Data-center build-out still compounding",
      stance: "long",
      conviction: 4,
      entry_price: 198.45,
      target_price: 250,
      horizon: "12–18 months",
      created_at: "2026-05-01T14:00:00Z",
      summary:
        "Data Center revenue was $89.0B in Q2 FY27 versus $41.1B a year earlier (10-Q, July 26, 2026). Hyperscaler capex keeps stepping up — Microsoft, Amazon and Alphabet spent a combined $168B on property and equipment in their latest quarters. As long as that spend grows, NVIDIA's networking and compute attach should keep revenue ahead of consensus.",
      catalysts: ["Q3 FY27 results (late Nov)", "Hyperscaler capex guidance for 2027", "Next-generation rack-scale systems ramp"],
      risks: ["Export controls on China shipments", "Customer concentration in a handful of clouds", "Gross margin normalization as new platforms ramp"],
      updates: [
        { kind: "earnings", body: "Q2 FY27: revenue $96.2B (+106% YoY), net income $59.7B. Data Center $89.0B. Thesis intact.", created_at: "2026-08-27T21:00:00Z" },
        { kind: "catalyst", body: "Amazon Q3 capex hit $77.3B, up from $54.2B in Q2 — demand signal for accelerators.", created_at: "2026-10-31T13:00:00Z" },
      ],
    },
    {
      ticker: "AAPL",
      title: "Services mix keeps lifting margins",
      stance: "long",
      conviction: 3,
      entry_price: 315.2,
      target_price: 360,
      horizon: "12 months",
      created_at: "2026-06-02T14:00:00Z",
      summary:
        "Services revenue reached $30.7B in the June 2026 quarter, up from $27.4B a year earlier, and now carries a much higher gross margin than hardware. As Services grows faster than Products, consolidated gross margin should keep drifting higher even in flat iPhone years.",
      catalysts: ["FY26 10-K (segment and margin disclosure)", "Holiday-quarter iPhone cycle", "Services pricing changes"],
      risks: ["App Store regulation in the EU and US", "Search default payments under antitrust remedies", "China demand"],
      updates: [
        { kind: "earnings", body: "Q3 FY26 (June qtr): revenue $109.4B, Services $30.7B (+12% YoY).", created_at: "2026-07-31T21:00:00Z" },
      ],
    },
    {
      ticker: "AMZN",
      title: "AWS + ads earn through the capex trough",
      stance: "long",
      conviction: 3,
      entry_price: 284.02,
      target_price: 320,
      horizon: "18–24 months",
      created_at: "2026-08-03T14:00:00Z",
      summary:
        "Capex rose to $77.3B in Q3 2026 and trailing free cash flow turned negative. The bet is that AWS capacity and advertising convert that spend into operating income growth by 2027–28; the stock has de-rated while the build is in progress.",
      catalysts: ["AWS growth re-acceleration", "Capex guide for 2027", "Advertising revenue disclosure"],
      risks: ["Capex keeps rising faster than AWS revenue", "Retail margin pressure", "Regulatory scrutiny of marketplace fees"],
      updates: [
        { kind: "risk", body: "Q3 2026 capex $77.3B vs $54.2B in Q2 — free cash flow deeper negative than modeled.", created_at: "2026-10-31T13:30:00Z" },
      ],
    },
    {
      ticker: "TSLA",
      title: "Auto margins don't support the multiple",
      stance: "short",
      conviction: 2,
      entry_price: 425.3,
      target_price: 330,
      horizon: "6–12 months",
      created_at: "2026-07-01T14:00:00Z",
      summary:
        "Trailing-twelve-month net income is about $3.2B on roughly $104B of revenue, with gross margin near 19%. The valuation leans on autonomy and robotics optionality that doesn't yet show up in the filings.",
      catalysts: ["Quarterly delivery reports", "Energy storage growth vs. auto decline", "Robotaxi expansion milestones"],
      risks: ["Autonomy breakthrough re-rates the stock", "Energy segment grows faster than expected", "Short squeeze dynamics"],
      updates: [],
    },
  ];

  for (const t of theses) {
    const { updates, ...row } = t;
    const { data, error } = await db
      .from("theses")
      .insert({ ...row, user_id: userId, updated_at: row.created_at })
      .select("id")
      .single();
    if (error || !data) continue;
    if (updates.length) {
      await db.from("thesis_updates").insert(updates.map((u) => ({ ...u, thesis_id: data.id, user_id: userId })));
    }
  }

  await db.from("documents").insert([
    {
      user_id: userId,
      kind: "doc",
      title: "NVDA — Q2 FY27 earnings notes",
      ticker: "NVDA",
      content: {
        html: `<h1>NVIDIA Q2 FY27 — notes</h1><p><strong>Headline:</strong> revenue of $96.2B for the quarter ended July 26, 2026, up 106% from $46.7B a year earlier. Net income was $59.7B.</p><h2>Segments</h2><ul><li>Data Center: $89.0B (vs $41.1B)</li><li>Compute &amp; Networking segment: $88.3B</li></ul><h2>What I'm watching</h2><ul><li>Hyperscaler capex: MSFT $39.4B, AMZN $77.3B, GOOGL $51.4B in the latest quarters.</li><li>Gross margin trajectory as new systems ramp.</li></ul><p>Sources: NVIDIA 10-Q for the period ended July 26, 2026; MSFT, AMZN and GOOGL 10-Q cash flow statements.</p>`,
      },
    },
    {
      user_id: userId,
      kind: "sheet",
      title: "Hyperscaler capex tracker ($M)",
      ticker: null,
      content: {
        rows: 30,
        cols: 12,
        cells: {
          A1: "Quarter (cal.)",
          B1: "Microsoft",
          C1: "Amazon",
          D1: "Alphabet",
          E1: "Total",
          F1: "QoQ %",
          A2: "Q4 2024",
          B2: "15804",
          C2: "27834",
          D2: "14276",
          A3: "Q1 2025",
          B3: "16745",
          C3: "25019",
          D3: "17197",
          A4: "Q2 2025",
          B4: "17079",
          C4: "32183",
          D4: "22446",
          A5: "Q3 2025",
          B5: "19394",
          C5: "35095",
          D5: "23953",
          A6: "Q4 2025",
          B6: "29876",
          C6: "39522",
          D6: "27851",
          A7: "Q1 2026",
          B7: "30876",
          C7: "44203",
          D7: "35674",
          A8: "Q2 2026",
          B8: "35802",
          C8: "54208",
          D8: "44924",
          A9: "Q3 2026",
          B9: "39367",
          C9: "77259",
          D9: "51355",
          E2: "=SUM(B2:D2)",
          E3: "=SUM(B3:D3)",
          E4: "=SUM(B4:D4)",
          E5: "=SUM(B5:D5)",
          E6: "=SUM(B6:D6)",
          E7: "=SUM(B7:D7)",
          E8: "=SUM(B8:D8)",
          E9: "=SUM(B9:D9)",
          F3: "=E3/E2-1",
          F4: "=E4/E3-1",
          F5: "=E5/E4-1",
          F6: "=E6/E5-1",
          F7: "=E7/E6-1",
          F8: "=E8/E7-1",
          F9: "=E9/E8-1",
          A11: "Source",
          B11: "Payments for property & equipment, 10-Q/10-K cash flow statements",
        },
        formats: { F: "pct" },
      },
    },
  ]);
}
