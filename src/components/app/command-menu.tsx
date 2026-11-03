import { useNavigate } from "@tanstack/react-router";
import { BookOpenText, Bot, Building2, FileSpreadsheet, Globe2, LayoutDashboard, LineChart, PieChart, Star, UserRoundSearch } from "lucide-react";
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
  { to: "/app/companies", label: "Companies", icon: Building2, keywords: "coverage universe screener" },
  { to: "/app/markets", label: "Technicals", icon: LineChart, keywords: "chart price rsi macd" },
  { to: "/app/sectors", label: "Sectors", icon: PieChart, keywords: "etf rotation heatmap" },
  { to: "/app/macro", label: "Macro", icon: Globe2, keywords: "fred rates inflation yield curve" },
  { to: "/app/insiders", label: "Insider trades", icon: UserRoundSearch, keywords: "form 4 trade following" },
  { to: "/app/theses", label: "Theses", icon: BookOpenText, keywords: "ideas notes long short" },
  { to: "/app/research", label: "Research agent", icon: Bot, keywords: "ai chat ask" },
  { to: "/app/docs", label: "Docs & sheets", icon: FileSpreadsheet, keywords: "excel word editor" },
];

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
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
              onSelect={() => run(() => navigate({ to: "/app/companies/$ticker", params: { ticker: c.ticker } }))}
            >
              <CompanyLogo ticker={c.ticker} src={c.logo} size="xs" />
              <span className="num font-medium">{c.ticker}</span>
              <span className="truncate text-muted-foreground">{c.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Follow / unfollow">
          {(universe.data?.companies ?? []).map((c) => (
            <CommandItem key={`f-${c.ticker}`} value={`follow ${c.ticker} ${c.name}`} onSelect={() => run(() => follow.toggle(c.ticker))}>
              <Star className={follow.isFollowed(c.ticker) ? "fill-current" : ""} />
              {follow.isFollowed(c.ticker) ? "Unfollow" : "Follow"} {c.ticker}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem key={p.to} value={`${p.label} ${p.keywords}`} onSelect={() => run(() => navigate({ to: p.to }))}>
              <p.icon /> {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Charts">
          {BENCHMARKS.filter((b) => b.group !== "sector").map((b) => (
            <CommandItem
              key={b.symbol}
              value={`chart ${b.symbol} ${b.name}`}
              onSelect={() => run(() => navigate({ to: "/app/markets", search: { symbol: b.symbol } }))}
            >
              <LineChart /> {b.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
