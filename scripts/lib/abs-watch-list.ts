// The CIKs the worker's ABS lane works through: the scheduled job's list (src/lib/abs/watch.ts) and the
// discovery candidates of scripts/data/abs-candidate-watch.json, one entry per CIK, the job's list first.
// A candidate is only a CIK to look at: the SEC reader decides the filing's issuer and file family.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ABS_WATCH, type AbsWatch } from "../../src/lib/abs/watch";

const CANDIDATES = fileURLToPath(new URL("../data/abs-candidate-watch.json", import.meta.url));

export function absWatchList(file = CANDIDATES): AbsWatch[] {
  const extra = existsSync(file) ? ((JSON.parse(readFileSync(file, "utf8")) as { candidates?: AbsWatch[] }).candidates ?? []) : [];
  return [
    ...new Map(
      [...ABS_WATCH, ...extra.filter((w) => Number.isInteger(w.cik) && w.cik > 0 && typeof w.name === "string")].map((w) => [w.cik, w]),
    ).values(),
  ];
}
