import { TrialBanner } from "@/hooks/use-plan";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile, useWatchlist, type AppPath } from "@/lib/workspace";
import {
  Activity,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  ChartCandlestick,
  Check,
  ChevronsUpDown,
  FileStack,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Satellite,
  Search,
  Truck,
  Users,
  X,
} from "lucide-react";
import { FirmProvider, useFirm } from "@/components/firm/firm-context";
import { supabase } from "@/integrations/supabase/client";
import { BrandMark, Logo } from "@/components/brand/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { HUB_GROUPS, hubFor, isPageActive } from "@/lib/nav";
import { CreditCard, ShieldCheck, CircleHelp, Keyboard, Compass, MessageCircleQuestion } from "lucide-react";
import { isTypingTarget, sequenceTarget } from "@/lib/shortcuts";
import { ShortcutsSheet } from "@/components/onboarding/shortcuts-sheet";
import { Tour } from "@/components/onboarding/tour";
import { useOnboarding, useStarterSeed } from "@/lib/onboarding/use-onboarding";

/** One glyph per sidebar entry, picked to read at a glance at 20px. */
const HUB_ICON: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  companies: Building2,
  filings: FileStack,
  markets: ChartCandlestick,
  supply: Truck,
  alt: Satellite,
  signals: Radar,
  paper: BriefcaseBusiness,
  agent: BrainCircuit,
  library: LibraryBig,
  firm: Users,
  admin: ShieldCheck,
};

export function AppShell({ children, isAdmin = false }: { children: ReactNode; isAdmin?: boolean }) {
  return (
    <FirmProvider>
      <SourceProvider>
        <ShellInner isAdmin={isAdmin}>{children}</ShellInner>
      </SourceProvider>
    </FirmProvider>
  );
}

function ShellInner({ children, isAdmin }: { children: ReactNode; isAdmin: boolean }) {
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
  // The assistant can collapse the sidebar while it shows something wide; "restore" goes back to the user's own setting.
  useEffect(() => {
    const onLayout = (e: Event) => {
      const want = (e as CustomEvent<{ sidebar?: string }>).detail?.sidebar;
      if (want === "collapse") setCollapsed(true);
      else if (want === "expand") setCollapsed(false);
      else if (want === "restore") setCollapsed(localStorage.getItem("fu:sidebar") === "1");
    };
    window.addEventListener("fu:layout", onLayout);
    return () => window.removeEventListener("fu:layout", onLayout);
  }, []);
  useEffect(() => setAiOpen(localStorage.getItem("fu:assistant") === "1"), []);
  useEffect(() => localStorage.setItem("fu:assistant", aiOpen ? "1" : "0"), [aiOpen]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    const openResearch = () => setAiOpen(true);
    window.addEventListener("fu:research-request", openResearch);
    return () => window.removeEventListener("fu:research-request", openResearch);
  }, []);
  const navigate = useNavigate();
  const [keysOpen, setKeysOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const onb = useOnboarding();
  useStarterSeed(onb.data);
  // First sign-in: start the tour once, after the starter workspace exists.
  useEffect(() => {
    if (onb.data?.seeded_at && !onb.data.tour_done_at && pathname === "/app" && !sessionStorage.getItem("fu:tour-shown")) {
      sessionStorage.setItem("fu:tour-shown", "1");
      const t = setTimeout(() => setTourOpen(true), 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [onb.data?.seeded_at, onb.data?.tour_done_at, pathname]);
  useEffect(() => {
    const t = () => setTourOpen(true);
    const k = () => setKeysOpen(true);
    window.addEventListener("fu:tour", t);
    window.addEventListener("fu:shortcuts", k);
    return () => { window.removeEventListener("fu:tour", t); window.removeEventListener("fu:shortcuts", k); };
  }, []);
  // Quick-start checklist ticks itself off as the user does each thing.
  const { tick } = onb;
  useEffect(() => { if (/^\/app\/companies\/[^/]+/.test(pathname)) tick("search"); if (pathname.startsWith("/app/office/")) tick("office"); }, [pathname, tick]);
  useEffect(() => { if (target) tick("source"); }, [target, tick]);
  useEffect(() => { if (aiOpen) tick("assistant"); }, [aiOpen, tick]);
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const to = sequenceTarget("G", e.key);
        if (to) { e.preventDefault(); void navigate({ to: to as never }); }
        return;
      }
      if (e.key === "g" || e.key === "G") { pendingG = Date.now(); return; }
      if (e.key === "?") { e.preventDefault(); setKeysOpen(true); return; }
      if (e.key === "/") { e.preventDefault(); setCmdOpen(true); return; }
      if (e.key === "[" || e.key === "]") {
        const tabs = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-tour^='tab-']"));
        const cur = tabs.findIndex((a) => a.getAttribute("aria-current") === "page" || a.dataset.status === "active");
        if (tabs.length && cur >= 0) tabs[(cur + (e.key === "]" ? 1 : -1) + tabs.length) % tabs.length]?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-[transform,width] duration-200 ease-out motion-reduce:transition-none lg:translate-x-0",
          collapsed && "lg:w-16",
          mobileOpen ? "translate-x-0 shadow-lift" : "-translate-x-full",
        )}
      >
        <SidebarContent
          onSearch={() => setCmdOpen(true)}
          collapsed={collapsed}
          isAdmin={isAdmin}
        />
      </aside>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-ink/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div
        className={cn("transition-[padding] duration-200 ease-out motion-reduce:transition-none", collapsed ? "lg:pl-16" : "lg:pl-60")}
        style={target ? ({ "--panel": PANEL_WIDTH } as React.CSSProperties) : undefined}
      >
        <div
          className={cn(
            "transition-[padding] duration-300",
            target && "min-[1760px]:pr-[var(--panel)]",
            !target && aiOpen && aiDocked && "md:pr-[min(var(--assistant-w,420px),100vw)]",
          )}
        >
          <header className="@container sticky top-0 z-20 flex h-12 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:px-6">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Menu"
            >
              {mobileOpen ? <X /> : <Menu />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className="-ml-2 hidden size-8 shrink-0 text-muted-foreground hover:text-foreground lg:inline-flex [&_svg]:size-[18px]"
            >
              {collapsed ? <PanelLeftOpen strokeWidth={1.8} /> : <PanelLeftClose strokeWidth={1.8} />}
            </Button>
            <span aria-hidden className="-ml-1 hidden h-5 w-px shrink-0 bg-border lg:block" />
            <Button
              variant="outline"
              onClick={() => setCmdOpen(true)}
              data-tour="search"
              aria-label="Search companies, pages, filings"
              className="h-8 min-w-0 w-full max-w-sm justify-start gap-2 bg-card px-2.5 text-sm text-muted-foreground"
            >
              <Search className="size-3.5" />
              <span className="flex-1 truncate text-left">Search companies, pages, filings…</span>
              <kbd className="num rounded border bg-muted px-1.5 text-[10px]">⌘K</kbd>
            </Button>
            <MarketTape />
            <div className="ml-auto md:ml-0">
              <AlertsBell />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Help and guide" title="Help and guide"><CircleHelp /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Help</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setTourOpen(true)}><Compass /> Take the tour</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setKeysOpen(true)}><Keyboard /> Keyboard shortcuts <kbd className="num ml-auto text-[10px] opacity-70">?</kbd></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("fu:research-request", { detail: "Show me around: what can I do in Filed Under, and where should I start? Point at things on the page as you explain." }))}><MessageCircleQuestion /> Ask the guide</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              data-tour="assistant"
              variant={aiOpen ? "ink" : "outline"}
              size="sm"
              className="shrink-0"
              onClick={() => setAiOpen((o) => !o)}
              aria-label="Assistant"
            >
              <Sparkles /> <span className="hidden sm:inline">Assistant</span>
              <kbd className="num hidden rounded border px-1 text-[10px] opacity-70 md:inline">
                ⌘J
              </kbd>
            </Button>
          </header>
          <main className="px-4 pb-12 pt-4 lg:px-6">
            <HubTabs pathname={pathname} />
            <TrialBanner />
            {children}
          </main>
        </div>
      </div>
      <AssistantPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        docked={aiDocked}
        onDockedChange={setAiDocked}
      />
      <SourcePanel />
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <ShortcutsSheet open={keysOpen} onOpenChange={setKeysOpen} />
      <Tour open={tourOpen} onClose={() => { setTourOpen(false); if (!onb.data?.tour_done_at) void onb.patch({ tour_done_at: new Date().toISOString() }); }} />
    </div>
  );
}

function SidebarContent({
  onSearch,
  collapsed,
  isAdmin,
}: {
  onSearch: () => void;
  collapsed: boolean;
  isAdmin: boolean;
}) {
  // Collapsing only applies on desktop; the phone drawer always shows labels.
  const lbl = collapsed ? "lg:hidden" : "";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const watch = useWatchlist();
  const universe = useUniverse();
  const tickers = (watch.data ?? []).map((w) => w.ticker);
  const quotes = useQuotes(tickers);
  const byTicker = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q]));

  const activeHub = hubFor(pathname)?.id;
  const groups = HUB_GROUPS.filter((g) => g.menu !== false && (!g.admin || isAdmin));
  // A collapsed rail is a column of 40px squares centred in the 64px strip.
  const rail = collapsed && "lg:mx-auto lg:flex lg:size-10 lg:justify-center lg:gap-0 lg:px-0";

  return (
    <>
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-sidebar-border px-4",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <Link to="/app" aria-label="Filed Under dashboard" className="flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo size="md" className={cn(collapsed && "lg:hidden")} />
          {collapsed && <BrandMark className="hidden h-7 lg:block" />}
        </Link>
      </div>
      <nav
        aria-label="Main"
        className={cn("flex-1 overflow-y-auto px-3 py-3 scrollbar-thin", collapsed && "lg:px-0")}
      >
        {groups.map((g, gi) => (
          <div key={g.heading} className={cn(gi > 0 && "mt-5", gi > 0 && collapsed && "lg:mt-3")}>
            <p className={cn("eyebrow px-2.5 pb-2", lbl)}>{g.heading}</p>
            {gi > 0 && collapsed && <div aria-hidden className="mx-auto mb-3 hidden h-px w-8 bg-sidebar-border lg:block" />}
            <ul className={cn("space-y-0.5", collapsed && "lg:space-y-1")}>
              {g.hubs.map((hub) => {
                const Icon = HUB_ICON[hub.id] ?? LayoutDashboard;
                const active = activeHub === hub.id;
                return (
                  <li key={hub.id}>
                    <RailTip label={hub.label} on={collapsed}>
                      <Link
                        to={hub.pages[0].to}
                        data-tour={`hub-${hub.id}`}
                        aria-current={active ? "page" : undefined}
                        aria-label={collapsed ? hub.label : undefined}
                        className={cn(
                          "group relative grid h-9 grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-2.5 text-[13.5px] text-sidebar-foreground/75 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
                          active && "bg-sidebar-accent font-medium text-sidebar-foreground before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-foreground",
                          rail,
                          active && collapsed && "lg:before:-left-3 lg:before:inset-y-2.5",
                        )}
                      >
                        <Icon
                          className={cn("size-5 justify-self-center transition-colors", active ? "text-sidebar-foreground" : "text-sidebar-foreground/65 group-hover:text-sidebar-foreground")}
                          strokeWidth={active ? 2 : 1.8}
                        />
                        <span className={cn("truncate", lbl)}>{hub.label}</span>
                      </Link>
                    </RailTip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className={cn("mt-5", collapsed && "lg:mt-3")}>
          <div className={cn("flex items-center justify-between px-2.5 pb-2", lbl)}>
            <p className="eyebrow">Watchlist</p>
            <button
              onClick={onSearch}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              + Add
            </button>
          </div>
          {collapsed && <div aria-hidden className="mx-auto mb-3 hidden h-px w-8 bg-sidebar-border lg:block" />}
          <ul className={cn("space-y-0.5", collapsed && "lg:space-y-1")}>
            {tickers.map((t) => {
              const q = byTicker.get(t);
              const u = universe.data?.companies.find((c) => c.ticker === t);
              return (
                <li key={t}>
                  <RailTip label={q ? `${t} · ${fmtPrice(q.price)} · ${fmtPct(q.changePct, 1, true)}` : t} on={collapsed}>
                    <Link
                      to="/app/companies/$ticker"
                      params={{ ticker: t }}
                      aria-label={collapsed ? t : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
                        pathname.startsWith(`/app/companies/${t}`) && "bg-sidebar-accent",
                        rail,
                      )}
                    >
                      <CompanyLogo ticker={t} src={u?.logo} size="xs" />
                      <span className={cn("num font-medium", lbl)}>{t}</span>
                      <span className={cn("num ml-auto text-[11px] text-muted-foreground", lbl)}>
                        {q ? fmtPrice(q.price) : ""}
                      </span>
                      {q && (
                        <span
                          className={cn(
                            "num w-12 text-right text-[11px]",
                            lbl,
                            q.changePct >= 0 ? "text-positive" : "text-negative",
                          )}
                        >
                          {fmtPct(q.changePct, 1, true)}
                        </span>
                      )}
                    </Link>
                  </RailTip>
                </li>
              );
            })}
            {!tickers.length && !watch.isLoading && (
              <li className={cn("px-2.5 text-xs text-muted-foreground", lbl)}>
                Follow a company to see it here.
              </li>
            )}
          </ul>
        </div>
      </nav>
      <UserMenu collapsed={collapsed} />
    </>
  );
}

/** Labels for the collapsed icon rail: a tooltip to the right instead of the hidden text. */
function RailTip({ label, on, children }: { label: string; on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="hidden lg:block">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const me = useProfile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const name = me.data?.profile?.display_name || me.data?.user.email?.split("@")[0] || "Analyst";
  const email = me.data?.user.email ?? "";
  const { firms, firm, setActive } = useFirm();

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className={cn("border-t border-sidebar-border p-2.5", collapsed && "lg:px-0 lg:py-2")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={collapsed ? `Account: ${name}` : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent",
              collapsed && "lg:mx-auto lg:size-11 lg:justify-center lg:p-0",
            )}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-ink-foreground">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
              <span className="block truncate text-[13px] font-medium">{name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {firm ? firm.name : email}
              </span>
            </span>
            <ChevronsUpDown
              className={cn("size-3.5 text-muted-foreground", collapsed && "lg:hidden")}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {email || "Signed in"}
          </DropdownMenuLabel>
          {firms.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                Switch firm
              </DropdownMenuLabel>
              {firms.map((f) => (
                <DropdownMenuItem key={f.id} onClick={() => setActive(f.id)}>
                  <Check
                    className={cn("size-4", f.id === firm?.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{f.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/app/firm">
              <Users className="size-4" /> {firm ? "Firm workspace" : "Create a firm"}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/">Front page</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/app/billing">
              <CreditCard className="size-4" /> Plan & billing
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/pricing">Access & pricing</Link>
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
    <div className="ml-auto hidden shrink-0 items-center gap-4 @min-[760px]:flex">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
        <Activity className="size-3" />
        {!q.data ? "Markets" : q.data.quotes.some((x) => "snapshot" in x) ? "Last close" : "Live"}
      </span>
      {(q.data?.quotes ?? []).map((x, i) => (
        <Link
          key={x.symbol}
          to="/app/markets"
          search={{ symbol: x.symbol }}
          className={cn(
            "num hidden items-baseline gap-1.5 whitespace-nowrap text-[11px]",
            i < 3 ? "@min-[1100px]:flex" : "@min-[1500px]:flex",
          )}
        >
          <span className="font-medium">{TAPE_LABEL[x.symbol] ?? x.symbol}</span>
          <span className="text-muted-foreground">{x.price.toFixed(2)}</span>
          <span className={x.changePct >= 0 ? "text-positive" : "text-negative"}>
            {fmtPct(x.changePct, 2, true)}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Tabs across the top of every page that belongs to a multi-page hub. */
function HubTabs({ pathname }: { pathname: string }) {
  const hub = hubFor(pathname);
  if (!hub || hub.pages.length < 2) return null;
  if (pathname.startsWith("/app/companies/")) return null;
  return (
    <nav aria-label={hub.label} className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b scrollbar-thin">
      {hub.pages.map((p) => {
        const active = isPageActive(p, pathname);
        return (
          <Link
            key={p.to}
            to={p.to}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors",
              active ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
