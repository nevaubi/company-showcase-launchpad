import type { CSSProperties, ReactNode } from "react";
import { readableOn, resolveBranding, type FirmBranding } from "@/lib/firm/core";

export const BRAND_FONT: Record<"sans" | "serif" | "mono", string> = {
  sans: "Geist, ui-sans-serif, system-ui, sans-serif",
  serif: "'Source Serif 4', Georgia, 'Times New Roman', serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, monospace",
};

/** CSS variables a branded report reads: --brand, --brand-ink, --brand-accent, --brand-font. */
export function brandStyle(b: FirmBranding | null | undefined): CSSProperties {
  const x = resolveBranding(b);
  return {
    ["--brand" as string]: x.primary,
    ["--brand-ink" as string]: readableOn(x.primary),
    ["--brand-accent" as string]: x.accent,
    ["--brand-font" as string]: BRAND_FONT[x.font],
  };
}

/** The cover band used on previews and exported reports. */
export function BrandedCover({ branding, logo, firmName, kicker, title, subtitle, meta, compact }: {
  branding: FirmBranding | null | undefined;
  logo?: string | null;
  firmName?: string;
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  compact?: boolean;
}) {
  const b = resolveBranding(branding);
  const ink = readableOn(b.primary);
  return (
    <div style={{ ...brandStyle(branding), background: b.primary, color: ink, fontFamily: BRAND_FONT[b.font] }} className={compact ? "px-5 py-4" : "px-7 py-6"}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {logo ? (
            <img src={logo} alt={firmName ? `${firmName} logo` : "Firm logo"} className="max-h-9 max-w-44 object-contain" style={{ filter: "none" }} />
          ) : firmName ? (
            <p className="text-sm font-semibold tracking-tight">{firmName}</p>
          ) : null}
        </div>
        {kicker && <p className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.08em] opacity-80">{kicker}</p>}
      </div>
      <div className={compact ? "mt-4" : "mt-8"} style={{ borderTop: `3px solid ${b.accent}`, paddingTop: compact ? 10 : 14 }}>
        <h2 className={compact ? "text-xl font-semibold leading-tight" : "text-[28px] font-semibold leading-tight"}>{title}</h2>
        {subtitle && <p className="mt-1 text-sm opacity-85">{subtitle}</p>}
        {meta && <div className="mt-3 text-[11px] opacity-75">{meta}</div>}
      </div>
    </div>
  );
}
