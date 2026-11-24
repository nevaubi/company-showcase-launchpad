// Number text for the hedge funds and funding page. Pure.
// A negative amount carries a true minus before the currency sign ("−$5.0B"), never "$-5.0B",
// and a value that rounds to zero carries no sign.
import { fmtSigned } from "@/lib/format";
import type { SeriesStats } from "./core";

const MINUS = "−";

const isDollars = (unit: string) => /dollars/i.test(unit);
const isPercent = (unit: string) => /percent/i.test(unit);

/** The sign for a printed magnitude: none when every printed digit is zero. */
const signFor = (v: number, digits: string, plus = false) =>
  !/[1-9]/.test(digits) ? "" : v < 0 ? MINUS : plus ? "+" : "";

/** A series value in its own unit: dollars compacted to M, B or T, percent, ratio (×) or a plain number. */
export function fmtHf(v: number, unit: string): string {
  const a = Math.abs(v);
  if (isDollars(unit)) {
    const body =
      a >= 1e12
        ? `${(a / 1e12).toFixed(2)}T`
        : a >= 1e9
          ? `${(a / 1e9).toFixed(1)}B`
          : a >= 1e6
            ? `${(a / 1e6).toFixed(1)}M`
            : a.toLocaleString("en-US");
    return `${signFor(v, body)}$${body}`;
  }
  if (isPercent(unit)) {
    const body = a.toFixed(a < 10 ? 2 : 1);
    return `${signFor(v, body)}${body}%`;
  }
  if (unit === "ratio") {
    const body = a.toFixed(2);
    return `${signFor(v, body)}${body}×`;
  }
  const body = a.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${signFor(v, body)}${body}`;
}

/**
 * The change over a year. A level that can be compared as a ratio gives a signed percentage; otherwise the signed
 * change in the series' own unit. The change of a percent series is in percentage points ("pts"), never "%",
 * which would read as a relative change.
 */
export function yoyText(
  s: Pick<SeriesStats, "yoy"> | null | undefined,
  unit: string,
): string | null {
  if (!s?.yoy) return null;
  if (s.yoy.pct != null) return `${fmtSigned(s.yoy.pct, 1)}% y/y`;
  const abs = s.yoy.abs;
  if (abs == null || !Number.isFinite(abs)) return null;
  const a = Math.abs(abs);
  const body =
    unit === "ratio" ? a.toFixed(2) : isPercent(unit) ? `${a.toFixed(2)} pts` : fmtHf(a, unit);
  return `${signFor(abs, body, true)}${body} y/y`;
}
