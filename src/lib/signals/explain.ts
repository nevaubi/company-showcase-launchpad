// Plain-language lines for the evidence behind a rule and for the day's verdict. Pure text built
// from evidence.ts, so the page, the tests and (later) the assistant say the same thing.
import { EVIDENCE, type Discovery, type EvidenceBook, type LiveCheck, type VariantEvidence } from "./evidence";
import { count, dayShort, num, pct } from "./format";

/** "+0.67% a trade after costs since 2022, 33 of 58 months up, t 1.88". */
export function recordLine(e: VariantEvidence): string {
  const b = e.blocks;
  if (!b) return "Fewer than 12 months with trades since 2022";
  return `${pct(b.mean)} a trade after costs since 2022, ${b.positive} of ${b.months} months up, t ${num(b.t)}`;
}

/** Why a rule's signals are on the list, or why they are not: its record, the bar it faces, the edge left. */
export function evidenceLine(e: VariantEvidence, d: Discovery): string {
  const record = recordLine(e);
  if (!e.blocks) return `${record}: nothing to judge yet.`;
  const rate = pct(e.q, 0, false);
  switch (e.grade) {
    case "proven":
      return `Passes all eight checks and stands out from ${d.tested} rules tried. ${record}. Expected edge today ${pct(e.edge)} a trade after shrinkage.`;
    case "candidate":
      return `${record}. Stands out from ${d.tested} rules tried: about ${rate} of rules listed this way would be luck. Expected edge today ${pct(e.edge)} a trade after shrinkage.`;
    case "watch":
      return `${record}. Borderline among ${d.tested} rules tried: about ${rate} of rules listed this way would be luck. Expected edge today ${pct(e.edge)} a trade after shrinkage.`;
    case "probation":
      return `${record}. Would be listed, but its live record is well below what the backtest allows.`;
    default: {
      const backtest = `Backtest ${pct(e.blocks.mean)} a trade after costs since 2022, ${e.blocks.positive} of ${e.blocks.months} months up`;
      if (!(e.blocks.mean > 0)) return `Does not make money after costs since 2022: ${pct(e.blocks.mean)} a trade, t ${num(e.blocks.t)}.`;
      if (e.blocks.months < EVIDENCE.minMonths) return `Not listed: only ${e.blocks.months} months of trades since 2022, two years needed (t ${num(e.blocks.t)}). ${backtest}.`;
      if (e.q <= EVIDENCE.watchFdr) return `Not listed today: it has lost money in markets like this one (t ${num(e.blocks.t)}). ${backtest}.`;
      return `Not listed: cannot be told apart from luck (t ${num(e.blocks.t)}, needs ${num(d.firstBarT)}). ${backtest}.`;
    }
  }
}

/** The live record in one line, with what it can and cannot say. `same` names rules whose live trades are these very trades. */
export function liveLine(l: LiveCheck, same: readonly string[] = []): string {
  if (!l.n || l.avgNet == null) return "No finished live trades yet.";
  const shared = same.length ? ` (the same trades as ${same.join(" and ")}: one record, not ${same.length + 1})` : "";
  const head = `${count(l.n)} finished live trades since ${dayShort(l.since)}${shared}: ${pct(l.avgNet)} a trade, ${pct(l.hit, 0, false)} up`;
  if (l.days == null) return `${head}. Not judged: the live trades by day did not load.`;
  const span = `${l.days} signal ${l.days === 1 ? "day" : "days"} in ${l.blocks} independent holding ${l.blocks === 1 ? "period" : "periods"}`;
  switch (l.verdict) {
    case "short":
      return `${head}. Too short to judge: ${span}, ${EVIDENCE.liveMinBlocks} periods needed.`;
    case "behind":
      return `${head}. Over ${span}, well below what the backtest allows.`;
    case "ahead":
      return `${head}. Over ${span}, above what the backtest led us to expect.`;
    case "in line":
      return `${head}. Over ${span}, in line with the backtest.`;
    default:
      return `${head}.`;
  }
}

/** The day's verdict: how many rules clear the bar, or how far the best is from it. */
export function verdictLine(book: Pick<EvidenceBook, "discovery">): string {
  const d = book.discovery;
  const listed = d.proven + d.candidates + d.watch;
  if (listed > 0) {
    const parts = [d.proven ? `${d.proven} proven` : "", d.candidates ? `${d.candidates} ${d.candidates === 1 ? "candidate" : "candidates"}` : "", d.watch ? `${d.watch} on watch` : ""].filter(Boolean);
    return `${listed} of ${d.tested} rules ${listed === 1 ? "clears" : "clear"} the bar today (${parts.join(", ")}).${d.probation ? ` ${d.probation} on probation.` : ""}`;
  }
  if (d.bestT == null) return `None of the ${d.tested} rules has a record to judge yet.`;
  return `No rule clears the bar today. The best of ${d.tested} scores t ${num(d.bestT)} on its monthly record since 2022. Luck alone would put the best of ${d.tested} worthless rules at about ${num(d.expectedBestT, 1)}, and the first rule has to reach ${num(d.firstBarT)} to be listed.`;
}

/**
 * What an empty short list means, with the edge a rule would need: a true monthly information ratio
 * of about bar / sqrt(months) gives an even chance of reaching the bar, so the annual Sharpe ratio
 * needed is bar * sqrt(12 / months), over the record lengths of the rules that can be listed.
 */
export function emptyListLine(book: Pick<EvidenceBook, "discovery" | "variants">): string {
  const d = book.discovery;
  const months = book.variants.flatMap((e) => (e.blocks && e.blocks.months >= EVIDENCE.minMonths ? [e.blocks.months] : []));
  const head = `No rule clears the bar today, so the short list is empty and nothing is added to fill it. The bar: with ${d.tested} rules tried, luck alone would give the best one a t near ${num(d.expectedBestT, 1)}, so the first rule has to reach ${num(d.firstBarT)} on its monthly record since 2022${d.bestT != null ? `; the best today reaches ${num(d.bestT)}` : ""}.`;
  if (!months.length) return head;
  const lo = d.firstBarT * Math.sqrt(12 / Math.max(...months)), hi = d.firstBarT * Math.sqrt(12 / Math.min(...months));
  const range = num(lo, 1) === num(hi, 1) ? `about ${num(lo, 1)}` : `roughly ${num(lo, 1)} to ${num(hi, 1)}`;
  return `${head} With ${Math.min(...months) === Math.max(...months) ? `${months[0]} months` : `${Math.min(...months)} to ${Math.max(...months)} months`} of history per rule, a rule would need an annual Sharpe ratio of ${range} after costs for an even chance of clearing it, which few short-term rules have. An empty list says that nothing here is exceptional, not that no rule has any edge.`;
}

/** The false-discovery reasoning in plain words, with today's numbers. */
export function luckLines(book: Pick<EvidenceBook, "discovery">): string[] {
  const d = book.discovery;
  const lucky = num(d.expectedAtSingleBar, 1);
  return [
    `${d.tested} rules are tried. Try that many worthless rules and some will look good by luck: the best would show a t-statistic of about ${num(d.expectedBestT, 1)}, and about ${lucky} would beat the usual one-test mark of ${num(EVIDENCE.singleTestT)}.`,
    `So a rule is not judged alone. Rules are lined up by how unlikely their record is under luck, and a rule is listed only while no more than about 1 in ${Math.round(1 / EVIDENCE.watchFdr)} of the rules listed with it would be expected to be luck (Benjamini-Hochberg control; 1 in ${Math.round(1 / EVIDENCE.candidateFdr)} for a candidate). The first rule has to reach t ${num(d.firstBarT)}.`,
    d.bestT == null
      ? "No rule has a record to judge yet."
      : `Today the best rule scores ${num(d.bestT)}, and ${d.atSingleBar} ${d.atSingleBar === 1 ? "rule beats" : "rules beat"} ${num(EVIDENCE.singleTestT)} where luck alone gives ${lucky}. ${d.proven + d.candidates + d.watch ? "" : "That is what luck looks like, so nothing is listed."}`.trim(),
  ];
}
