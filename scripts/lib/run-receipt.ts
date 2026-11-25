/**
 * What a worker child did, handed to the worker that started it. The child writes one small JSON
 * file at the path it was given (`--receipt=<file>`); the worker reads it after the child exits and
 * stores it as the `detail` of the run's `job_runs` row. A child that was killed leaves no file, and
 * the worker then says only how the process ended.
 *
 * Nothing here may carry a secret: every string is scrubbed when the receipt is written and again
 * when it is read, so a careless error message cannot put a key or a signed address in the ledger.
 */
import { lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RECEIPT_MAX_BYTES = 64 * 1024;

/**
 * Text fit for `job_runs` and `job_state`: one line, bounded, with URL query strings, fragments and
 * user names removed and anything that looks like a credential replaced. The host and path of a URL
 * stay, because they say which publisher failed.
 */
export function receiptText(value: unknown, max = 240): string {
  return String(value instanceof Error ? value.message : value)
    .replace(/(https?:\/\/)[^\s/@"'<>]+@/gi, "$1")
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1")
    .replace(/\b(api[_-]?key|apikey|access[_-]?token|token|secret|password|authorization|signature)\b(\s*[=:]\s*)(?:bearer\s+)?[^\s,;&"']+/gi, "$1$2[removed]")
    .replace(/(?:sb_secret_|sb_publishable_|eyJ)[A-Za-z0-9_.-]+/g, "[credential]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, max));
}

/** The same scrub over a whole receipt: strings cleaned, depth and list length bounded. */
export function scrubReceipt(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return receiptText(value, 500);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 6) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => scrubReceipt(item, depth + 1));
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .slice(0, 200)
        .map(([key, item]) => [receiptText(key, 80), scrubReceipt(item, depth + 1)]),
    );
  return null;
}

/**
 * Writes the receipt in one step (a temporary file, then a rename), so the worker never reads half
 * of it. Without a path nothing is written: a run by hand has no worker waiting for it. Never throws:
 * a receipt that cannot be written must not change how the run itself ended. The folder is the
 * worker's to create; a child never makes directories for it (a recursive mkdir on a path that can
 * never exist does not return in Node, and a receipt is not worth a stuck process).
 */
export function writeRunReceipt(path: string | undefined, receipt: Record<string, unknown>): boolean {
  if (!path) return false;
  try {
    const text = JSON.stringify(scrubReceipt(receipt));
    if (Buffer.byteLength(text) > RECEIPT_MAX_BYTES) throw new Error("receipt too large");
    const part = `${path}.part`;
    writeFileSync(part, text, { mode: 0o600 });
    renameSync(part, path);
    return true;
  } catch {
    return false;
  }
}

/** Reads a child's receipt and removes the file. Null when there is none or it is not a small JSON object. */
export function takeRunReceipt(path: string): Record<string, unknown> | null {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.size > RECEIPT_MAX_BYTES) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return scrubReceipt(parsed) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    rmSync(path, { force: true });
    rmSync(`${path}.part`, { force: true });
  }
}

/** Removes receipt files a crashed worker never read. Only plain files directly in the folder. */
export function sweepRunReceipts(directory: string, olderThanMs = 24 * 3600_000, now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!/\.json(\.part)?$/.test(name)) continue;
    const file = join(directory, name);
    try {
      const st = lstatSync(file);
      if (!st.isFile() || now - st.mtimeMs < olderThanMs) continue;
      rmSync(file, { force: true });
      removed++;
    } catch {
      /* gone already */
    }
  }
  return removed;
}
