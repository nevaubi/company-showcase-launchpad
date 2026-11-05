import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile, useWatchlist, type AppPath } from "@/lib/workspace";
import {
  Activity,
  BookOpenText,
  Bot,
  Building2,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  DatabaseZap,
  FileSpreadsheet,
  Globe2,
  Landmark,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Network,
  Crosshair,
  PieChart,
  Search,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/brand/logo";
import { SourceProvider, useSource } from "@/components/source/source-context";
import { PANEL_WIDTH, SourcePanel } from "@/components/source/source-panel";
import { AssistantPanel } from "@/components/research/assistant-panel";
import { Sparkles } from "lucide-react";
import { CommandMenu } from "@/components/app/command-menu";
import { AlertsBell } from "@/components/app/alerts-bell";
import { CompanyLogo } from "@/components/app/company-logo";
import { useQuotes, useUniverse } from "@/lib/data";
import { fmtPct, fmtPrice } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = { to: AppPath; label: string; icon: typeof LayoutDashboard; exact?: boolean };

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Research",
    items: [
      { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/app/companies", label: "Companies", icon: Building2 },
    ],
  },
  {
    heading: "Markets",
    items: [
      { to: "/app/markets", label: "Technicals", icon: LineChart },
      { to: "/app/sectors", label: "Sectors", icon: PieChart },
      { to: "/app/alt-data", label: "Alt data", icon: Activity },
      { to: "/app/hedge-funds", label: "Hedge funds", icon: Landmark },
      { to: "/app/ideas", label: "Trade ideas", icon: Crosshair },
      { to: "/app/supply-chain", label: "Supply chain", icon: Network },
      { to: "/app/macro", label: "Macro", icon: Globe2 },
    ],
  },
  {
    heading: "Workspace",
    items: [
      { to: "/app/theses", label: "Theses", icon: BookOpenText },
      { to: "/app/research", label: "Research agent", icon: Bot },
      { to: "/app/docs", label: "Docs & sheets", icon: FileSpreadsheet },
      { to: "/app/status", label: "Data status", icon: DatabaseZap },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SourceProvider>
      <ShellInner>{children}</ShellInner>
    </SourceProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const { target } = useSource();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDocked, setAiDocked] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(localStorage.getItem("fu:sidebar") === "1"), []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      localStorage.setItem("fu:sidebar", c ? "0" : "1");
      return !c;
    });
  useEffect(() => setAiOpen(localStorage.getItem("fu:assistant") === "1"), []);
  useEffect(() => localStorage.setItem("fu:assistant", aiOpen ? "1" : "0"), [aiOpen]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-[transform,width] lg:translate-x-0",
          collapsed && "lg:w-14",
          mobileOpen ? "translate-x-0 shadow-lift" : "-translate-x-full",
        )}
      >
        <SidebarContent onSearch={() => setCmdOpen(true)} collapsed={collapsed} onToggle={toggleCollapsed} />
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-20 bg-ink/30 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div
        className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-14" : "lg:pl-60")}
        style={target ? ({ "--panel": PANEL_WIDTH } as React.CSSProperties) : undefined}
      >
        <div className={cn("transition-[padding] duration-300", target && "min-[1760px]:pr-[var(--panel)]", !target && aiOpen && aiDocked && "md:pr-[min(420px,100vw)]")}>
          <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:px-6">
            <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen((o) => !o)} aria-label="Menu">
              {mobileOpen ? <X /> : <Menu />}
            </Button>
            <button
              onClick={() => setCmdOpen(true)}
              className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border bg-card px-2.5 text-sm text-muted-foreground shadow-paper transition-colors hover:border-rule"
            >
              <Search className="size-3.5" />
              <span className="flex-1 truncate text-left">Search companies, pages, filings…</span>
              <kbd className="num rounded border bg-muted px-1.5 text-[10px]">⌘K</kbd>
            </button>
            <MarketTape />
            <div className="ml-auto md:ml-0"><AlertsBell /></div>
            <Button variant={aiOpen ? "ink" : "outline"} size="sm" className="shrink-0" onClick={() => setAiOpen((o) => !o)} aria-label="Assistant">
              <Sparkles /> <span className="hidden sm:inline">Assistant</span>
              <kbd className="num hidden rounded border px-1 text-[10px] opacity-70 md:inline">⌘J</kbd>
            </Button>
          </header>
          <main className="px-4 pb-12 pt-4 lg:px-6">{children}</main>
        </div>
      </div>
      <AssistantPanel open={aiOpen} onClose={() => setAiOpen(false)} docked={aiDocked} onDockedChange={setAiDocked} />
      <SourcePanel />
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}

function SidebarContent({ onSearch, collapsed, onToggle }: { onSearch: () => void; collapsed: boolean; onToggle: () => void }) {
  // Collapsing only applies on desktop; the phone drawer always shows labels.
  const lbl = collapsed ? "lg:hidden" : "";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const watch = useWatchlist();
  const universe = useUniverse();
  const tickers = (watch.data ?? []).map((w) => w.ticker);
  const quotes = useQuotes(tickers);
  const byTicker = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q]));

  const isActive = (item: NavItem) => (item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/"));

  return (
    <>
      <div className={cn("flex h-12 items-center gap-2 border-b border-sidebar-border px-4", collapsed && "lg:justify-center lg:px-0")}>
        <Link to="/app" className={lbl}>
          <Logo size="sm" />
        </Link>
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="ml-auto hidden rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:block"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
      <nav className={cn("flex-1 space-y-4 overflow-y-auto px-2.5 py-3 scrollbar-thin", collapsed && "lg:px-1.5")}>
        {NAV.map((g) => (
          <div key={g.heading}>
            <p className={cn("eyebrow px-2 pb-1.5", lbl)}>{g.heading}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      isActive(item) && "bg-sidebar-accent font-medium text-sidebar-foreground",
                      collapsed && "lg:justify-center lg:px-0",
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon className="size-4 shrink-0 opacity-80" />
                    <span className={lbl}>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <div className={cn("flex items-center justify-between px-2 pb-1.5", lbl)}>
            <p className="eyebrow">Watchlist</p>
            <button onClick={onSearch} className="text-[11px] text-muted-foreground hover:text-foreground">
              + Add
            </button>
          </div>
          <ul className="space-y-0.5">
            {tickers.map((t) => {
              const q = byTicker.get(t);
              const u = universe.data?.companies.find((c) => c.ticker === t);
              return (
                <li key={t}>
                  <Link
                    to="/app/companies/$ticker"
                    params={{ ticker: t }}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors hover:bg-sidebar-accent",
                      pathname.startsWith(`/app/companies/${t}`) && "bg-sidebar-accent",
                      collapsed && "lg:justify-center lg:px-0",
                    )}
                    title={collapsed ? t : undefined}
                  >
                    <CompanyLogo ticker={t} src={u?.logo} size="xs" />
                    <span className={cn("num font-medium", lbl)}>{t}</span>
                    <span className={cn("num ml-auto text-[11px] text-muted-foreground", lbl)}>{q ? fmtPrice(q.price) : ""}</span>
                    {q && (
                      <span className={cn("num w-12 text-right text-[11px]", lbl, q.changePct >= 0 ? "text-positive" : "text-negative")}>
                        {fmtPct(q.changePct, 1, true)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
            {!tickers.length && !watch.isLoading && <li className={cn("px-2 text-xs text-muted-foreground", lbl)}>Follow a company to see it here.</li>}
          </ul>
        </div>
      </nav>
      <UserMenu collapsed={collapsed} />
    </>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const me = useProfile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const name = me.data?.profile?.display_name || me.data?.user.email?.split("@")[0] || "Analyst";
  const email = me.data?.user.email ?? "";

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className={cn("border-t border-sidebar-border p-2.5", collapsed && "lg:p-1.5")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sidebar-accent">
            <span className="flex size-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-ink-foreground">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
              <span className="block truncate text-[13px] font-medium">{name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{email}</span>
            </span>
            <ChevronsUpDown className={cn("size-3.5 text-muted-foreground", collapsed && "lg:hidden")} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {me.data?.profile?.is_demo ? "Shared demo workspace" : "Signed in"}
          </DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link to="/">Front page</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/pricing">Plans & pricing</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="size-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const TAPE = ["SPY", "QQQ", "IWM", "^VIX", "TLT", "GLD"];
const TAPE_LABEL: Record<string, string> = { "^VIX": "VIX" };

function MarketTape() {
  const q = useQuotes(TAPE);
  return (
    <div className="ml-auto hidden items-center gap-4 md:flex">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
        <Activity className="size-3" />
        {!q.data ? "Markets" : q.data.quotes.some((x) => "snapshot" in x) ? "Last close" : "Live"}
      </span>
      {(q.data?.quotes ?? []).map((x, i) => (
        <Link
          key={x.symbol}
          to="/app/markets"
          search={{ symbol: x.symbol }}
          className={cn("num hidden items-baseline gap-1.5 whitespace-nowrap text-[11px]", i < 3 ? "xl:flex" : "2xl:flex")}
        >
          <span className="font-medium">{TAPE_LABEL[x.symbol] ?? x.symbol}</span>
          <span className="text-muted-foreground">{x.price.toFixed(2)}</span>
          <span className={x.changePct >= 0 ? "text-positive" : "text-negative"}>{fmtPct(x.changePct, 2, true)}</span>
        </Link>
      ))}
    </div>
  );
}
