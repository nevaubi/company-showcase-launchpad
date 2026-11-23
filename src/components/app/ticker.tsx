import type { MouseEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CompanyLogo } from "@/components/app/company-logo";
import { coverageOf } from "@/lib/coverage";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: { logo: "xs", gap: "gap-1.5", symbol: "text-[13px] leading-5", name: "text-[13px] leading-5" },
  sm: { logo: "sm", gap: "gap-2", symbol: "text-sm leading-5", name: "text-sm leading-5" },
  md: { logo: "md", gap: "gap-2.5", symbol: "text-base leading-6", name: "text-sm leading-5" },
} as const;

export interface TickerMarkProps {
  ticker: string;
  /** `true` adds the covered company's short name; a string adds that text instead. */
  name?: boolean | string;
  /** Put the name first and the symbol after it, quieter ("Apple AAPL"). Needs `name`. */
  nameFirst?: boolean;
  size?: keyof typeof SIZES;
  /** Covered companies link to their page. Turn off inside a row, card or button that is already one target. */
  link?: boolean;
  /** Logo URL from the data, used only when no bundled mark exists. */
  logoSrc?: string;
  /** Extra content after the symbol and name (a badge, a figure). */
  children?: ReactNode;
  className?: string;
}

/**
 * A ticker as it appears anywhere in the app: the company's own mark, the symbol in tabular
 * figures and, when asked, the name. Use this (or CompanyLogo next to your own text) wherever a
 * ticker is shown, so the same company always carries the same logo.
 */
export function TickerMark({ ticker, name, nameFirst, size = "xs", link = true, logoSrc, children, className }: TickerMarkProps) {
  const t = ticker.toUpperCase();
  const covered = coverageOf(t);
  const s = SIZES[size];
  const label = typeof name === "string" ? name : name ? (covered?.shortName ?? "") : "";
  const symbol = (
    <span className={cn("num shrink-0 font-semibold tracking-tight", s.symbol, nameFirst && label && "font-normal text-muted-foreground")}>{t}</span>
  );
  const text = label ? (
    <span className={cn("min-w-0 truncate", s.name, nameFirst ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
  ) : null;
  const body = (
    <>
      <CompanyLogo ticker={t} src={logoSrc} size={s.logo} decorative />
      {nameFirst ? text : symbol}
      {nameFirst ? symbol : text}
      {children}
    </>
  );
  const cls = cn("inline-flex min-w-0 max-w-full items-center align-middle", s.gap, className);
  if (link && covered) {
    return (
      <Link
        to="/app/companies/$ticker"
        params={{ ticker: t }}
        data-ticker={t}
        title={label ? undefined : covered.shortName}
        onClick={(e: MouseEvent) => e.stopPropagation()}
        className={cn(
          cls,
          "rounded-sm underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {body}
      </Link>
    );
  }
  return (
    <span data-ticker={t} title={label ? undefined : covered?.shortName} className={cls}>
      {body}
    </span>
  );
}
