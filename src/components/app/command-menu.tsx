import { useNavigate } from "@tanstack/react-router";
import {
  BookOpenText,
  Bot,
  Briefcase,
  Building2,
  Columns3,
  CalendarDays,
  CreditCard,
  Database,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Globe2,
  Grid3x3,
  Landmark,
  Lightbulb,
  LayoutDashboard,
  Library,
  LineChart,
  Network,
  PieChart,
  Sigma,
  SlidersHorizontal,
  Star,
  TrendingUp,
  Users,
  Radar,
  Settings,
  BellRing,
  CalendarCheck,
  Workflow,
  Zap,
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
import { useToggleFollow } from "@/lib/workspace";
import { BENCHMARKS } from "@/lib/coverage";
import { groupByHub, HUB_GROUPS, type NavPath } from "@/lib/nav";
import { TickerMark } from "@/components/app/ticker";

/** Icon and search words for each page; labels and grouping come from the navigation in nav.ts. */
const PAGE_META: Record<string, { icon: typeof Building2; keywords: string }> = {
  "/app": { icon: LayoutDashboard, keywords: "home overview dashboard" },
  "/app/companies": { icon: Building2, keywords: "coverage universe screener" },
  "/app/screener": {
    icon: SlidersHorizontal,
    keywords: "screen filter prompt ai valuation growth momentum",
  },
  "/app/compare": { icon: Columns3, keywords: "side by side peers comparison" },
  "/app/kpis": {
    icon: Grid3x3,
    keywords: "kpi operating metrics comps backlog nim occupancy subscribers",
  },
  "/app/exposures": {
    icon: Globe2,
    keywords:
      "geography region country china taiwan europe tariff revenue exposure banks lenders loans deposits charge-offs allowance nonaccrual credit",
  },
  "/app/filings": {
    icon: FileSearch,
    keywords: "10-k 10-q redline disclosure changes risk factors filing insights what changed",
  },
  "/app/earnings": {
    icon: CalendarCheck,
    keywords: "earnings season calendar beats misses surprise reaction preview scorecard",
  },
  "/app/calendars": {
    icon: CalendarDays,
    keywords: "earnings dates economic calendar cpi jobs fomc dividends ex-dividend ipo",
  },
  "/app/supply-chain": {
    icon: Network,
    keywords: "customers suppliers partners competitors shock map exposure",
  },
  "/app/alt-data": {
    icon: Database,
    keywords: "alternative data contracts fda recalls complaints cfpb fdic registries",
  },
  "/app/markets": { icon: LineChart, keywords: "chart price rsi macd" },
  "/app/options": {
    icon: Sigma,
    keywords: "implied volatility iv rank put call skew unusual volume expected move",
  },
  "/app/sectors": { icon: PieChart, keywords: "etf rotation heatmap" },
  "/app/macro": { icon: Globe2, keywords: "fred rates inflation yield curve" },
  "/app/hedge-funds": { icon: Landmark, keywords: "13f leverage positioning crowding" },
  "/app/feed": {
    icon: Radar,
    keywords:
      "feed changes alerts news since last visit digest today insider filing 8-k analyst upgrades downgrades monitor",
  },
  "/app/situations": {
    icon: Radar,
    keywords:
      "screens insider buying cheap material weakness going concern auditor change covenant bridge loan federal contracts single source customer concentration red flags",
  },
  "/app/insights": {
    icon: Lightbulb,
    keywords:
      "kpi insights operating data trends mix traffic ticket backlog federal contracts lobbying short volume congress",
  },
  "/app/agents": {
    icon: BellRing,
    keywords:
      "agents scheduled tasks monitors alerts inbox reports morning brief earnings preview insights for you",
  },
  "/app/setups": { icon: Zap, keywords: "signals strategies out of sample swing trades" },
  "/app/ideas": { icon: TrendingUp, keywords: "ideas long short rule based" },
  "/app/autopilots": { icon: Workflow, keywords: "paper trading bots automated" },
  "/app/portfolio": { icon: Briefcase, keywords: "paper trades positions pnl" },
  "/app/research": { icon: Bot, keywords: "ai chat ask" },
  "/app/theses": { icon: BookOpenText, keywords: "ideas notes long short" },
  "/app/reports": {
    icon: FileText,
    keywords: "report library primer earnings preview recap ic memo pdf word download branded",
  },
  "/app/office": {
    icon: FileSpreadsheet,
    keywords: "excel word powerpoint pdf editor docs sheets officeai",
  },
  "/app/settings": {
    icon: Settings,
    keywords: "profile preferences appearance theme dark light mode account",
  },
  "/app/firm": {
    icon: Users,
    keywords: "firm workspace team coverage roles invite branding restricted list",
  },
  "/app/billing": {
    icon: CreditCard,
    keywords: "plan billing subscription trial usage upgrade invoice",
  },
};

/** Every non-admin page in the navigation, so the menu cannot fall behind the sidebar and account menu. */
const PAGES: { to: NavPath; label: string; icon: typeof Building2; keywords: string }[] =
  HUB_GROUPS.filter((g) => !g.admin).flatMap((g) =>
    g.hubs.flatMap((h) =>
      h.pages.map((p) => ({
        to: p.to,
        label: p.label,
        icon: PAGE_META[p.to]?.icon ?? LayoutDashboard,
        keywords: PAGE_META[p.to]?.keywords ?? "",
      })),
    ),
  );

/** Pages inside a hub page that the menu offers too; each stays under its hub's tab ("Data library" under Alt data). */
const SECTION_PAGES: { to: NavPath; label: string; icon: typeof Building2; keywords: string }[] = [
  {
    to: "/app/alt-data/library",
    label: "Data library",
    icon: Library,
    keywords:
      "official tables agencies publishers collections fdic eia fhfa usgs fred federal reserve sec bea bls call reports house prices energy source explorer",
  },
];

/** Pages grouped under the sidebar entry (or the account menu) that holds them. */
const PAGE_GROUPS = groupByHub([...PAGES, ...SECTION_PAGES]);

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
        <CommandGroup heading="Tickers">
          {(universe.data?.companies ?? []).map((c) => (
            <CommandItem
              key={c.ticker}
              value={`${c.ticker} ${c.name} ${c.industry}`}
              onSelect={() =>
                run(() => navigate({ to: "/app/companies/$ticker", params: { ticker: c.ticker } }))
              }
            >
              <CompanyLogo ticker={c.ticker} size="xs" decorative />
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
              {follow.isFollowed(c.ticker) ? "Unfollow" : "Follow"} <TickerMark ticker={c.ticker} link={false} />
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        {PAGE_GROUPS.map((g) => (
          <CommandGroup key={g.hub.id} heading={g.hub.label}>
            {g.items.map((p) => (
              <CommandItem
                key={p.to}
                value={`${p.label} ${p.keywords}`}
                onSelect={() => run(() => navigate({ to: p.to }))}
              >
                <p.icon /> {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
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
