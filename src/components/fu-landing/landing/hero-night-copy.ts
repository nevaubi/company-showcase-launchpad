import { defaultTape, type NightHeroCopy } from "./hero-video";

/**
 * Copy variants for ChicagoNightVideoHero. Pass one as `copy`.
 * All share the verification tape; swap `tape` per variant if you want different rows.
 */
export const nightCopyVariants: { key: string; name: string; copy: NightHeroCopy }[] = [
  {
    key: "most-intelligent",
    name: "A: Most intelligent",
    copy: {
      eyebrow: "Source-grounded financial research",
      title: "The most intelligent AI for financial markets research",
      lede: "FiledUnder reads every filing, backfills the complete history and re-checks every number as new data lands. Each figure links to the exact page it came from.",
      proof: ["Full history backfilled", "Continuous accuracy checks", "Every number cited"],
      tape: defaultTape,
    },
  },
  {
    key: "never-double-check",
    name: "B: Never double-check",
    copy: {
      eyebrow: "AI research and analysis for financial markets",
      title: "Market research you never have to double-check",
      lede: "Every value is pulled from the source filing, reconciled against the rest of the statement and verified again on every new release. Nothing reaches you without a citation.",
      proof: ["Reconciled to the statement", "Re-verified every release", "Cited to the page"],
      tape: defaultTape,
    },
  },
  {
    key: "shows-its-work",
    name: "C: Shows its work",
    copy: {
      eyebrow: "Backfilled. Maintained. Verified.",
      title: "Financial markets AI that shows its work",
      lede: "A complete filing history, kept current as companies report and restate. Accuracy checks run on every update, and any number opens to the line it came from.",
      proof: ["Complete backfill", "Maintained on every filing", "One click to the source"],
      tape: defaultTape,
    },
  },
  {
    key: "every-number-sourced",
    name: "D: Every number sourced",
    copy: {
      eyebrow: "The most intelligent AI for market research",
      title: "Every number sourced. Every filing checked.",
      lede: "FiledUnder is AI research and analysis for financial markets, built on a fully backfilled filing history that is maintained and audited around the clock.",
      proof: ["Source-grounded answers", "Endless accuracy checks", "Always up to date"],
      tape: defaultTape,
    },
  },
  {
    key: "grounded-in-filings",
    name: "E: Grounded in the filings",
    copy: {
      eyebrow: "Accuracy is the product",
      title: "AI market analysis, grounded in the filings",
      lede: "We backfill years of 10-Ks, 10-Qs and 8-Ks, maintain them as companies revise, and run accuracy checks before any figure is shown. If we can't source it, we don't say it.",
      proof: ["Years of history", "Restatements tracked", "No unsourced numbers"],
      tape: defaultTape,
    },
  },
];
