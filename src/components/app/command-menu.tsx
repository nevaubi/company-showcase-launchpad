import { useNavigate } from "@tanstack/react-router";
import {
  BookOpenText,
  Bot,
  Building2,
  Columns3,
  CalendarDays,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Globe2,
  Grid3x3,
  LayoutDashboard,
  LineChart,
  PieChart,
  SlidersHorizontal,
  Star,
  Users,
  Radar,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { CompanyLogo } from "@/components/app/company-logo";
import { useUniverse } from "@/lib/data";
import { useToggleFollow, type AppPath } from "@/lib/workspace";
import { BENCHMARKS } from "@/lib/coverage";

const PAGES: { to: AppPath; label: string; icon: typeof Building2; keywords: string }[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, keywords: "home overview" },
  {
    to: "/app/companies",
    label: "Companies",
    icon: Building2,
    keywords: "coverage universe screener",
  },
  {
    to: "/app/screener",
    label: "Screener",
    icon: SlidersHorizontal,
    keywords: "screen filter prompt ai valuation growth momentum",
  },
  {
    to: "/app/filings",
    label: "Filings",
    icon: FileSearch,
    keywords: "10-k 10-q redline disclosure changes risk factors filing insights what changed",
  },
  {
    to: "/app/kpis",
    label: "KPI matrix",
    icon: Grid3x3,
    keywords: "kpi operating metrics comps backlog nim occupancy subscribers",
  },
  { to: "/app/markets", label: "Technicals", icon: LineChart, keywords: "chart price rsi macd" },
  {
    to: "/app/feed",
    label: "What changed",
    icon: Radar,
    keywords:
      "feed changes alerts news since last visit digest today insider filing 8-k analyst upgrades downgrades monitor",
  },
  {
    to: "/app/calendars",
    label: "Calendars",
    icon: CalendarDays,
    keywords: "earnings dates economic calendar cpi jobs fomc dividends ex-dividend ipo",
  },
  { to: "/app/sectors", label: "Sectors", icon: PieChart, keywords: "etf rotation heatmap" },
  { to: "/app/macro", label: "Macro", icon: Globe2, keywords: "fred rates inflation yield curve" },
  { to: "/app/theses", label: "Theses", icon: BookOpenText, keywords: "ideas notes long short" },
  { to: "/app/research", label: "Research agent", icon: Bot, keywords: "ai chat ask" },
  {
    to: "/app/reports",
    label: "Report library",
    icon: FileText,
    keywords: "primer earnings preview recap ic memo pdf word download branded",
  },
  { to: "/app/docs", label: "Docs & sheets", icon: FileSpreadsheet, keywords: "excel word editor" },
  {
    to: "/app/firm",
    label: "Firm workspace",
    icon: Users,
    keywords: "team coverage roles invite branding restricted list",
  },
];

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const universe = useUniverse();
  const follow = useToggleFollow();

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search tickers, companies or pages…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Companies">
          {(universe.data?.companies ?? []).map((c) => (
            <CommandItem
              key={c.ticker}
              value={`${c.ticker} ${c.name} ${c.industry}`}
              onSelect={() =>
                run(() => navigate({ to: "/app/companies/$ticker", params: { ticker: c.ticker } }))
              }
            >
              <CompanyLogo ticker={c.ticker} src={c.logo} size="xs" />
              <span className="num font-medium">{c.ticker}</span>
              <span className="truncate text-muted-foreground">{c.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Follow / unfollow">
          {(universe.data?.companies ?? []).map((c) => (
            <CommandItem
              key={`f-${c.ticker}`}
              value={`follow ${c.ticker} ${c.name}`}
              onSelect={() => run(() => follow.toggle(c.ticker))}
            >
              <Star className={follow.isFollowed(c.ticker) ? "fill-current" : ""} />
              {follow.isFollowed(c.ticker) ? "Unfollow" : "Follow"} {c.ticker}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem
              key={p.to}
              value={`${p.label} ${p.keywords}`}
              onSelect={() => run(() => navigate({ to: p.to }))}
            >
              <p.icon /> {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Charts">
          {BENCHMARKS.filter((b) => b.group !== "sector").map((b) => (
            <CommandItem
              key={b.symbol}
              value={`chart ${b.symbol} ${b.name}`}
              onSelect={() =>
                run(() => navigate({ to: "/app/markets", search: { symbol: b.symbol } }))
              }
            >
              <LineChart /> {b.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
