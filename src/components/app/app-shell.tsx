import { TrialBanner } from "@/hooks/use-plan";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile, useWatchlist, type AppPath } from "@/lib/workspace";
import {
  Activity,
  BookOpenText,
  Building2,
  Check,
  ChevronsUpDown,
  CircleHelp,
  Compass,
  CreditCard,
  Crosshair,
  FileSearch,
  Keyboard,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  MessageCircleQuestion,
  PanelLeftClose,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { FirmProvider, useFirm } from "@/components/firm/firm-context";
import { supabase } from "@/integrations/supabase/client";
import { BrandMark, Logo } from "@/components/brand/logo";
import { SourceProvider, useSource } from "@/components/source/source-context";
import { PANEL_WIDTH, SourcePanel } from "@/components/source/source-panel";
import { AssistantPanel } from "@/components/research/assistant-panel";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SIDEBAR_HUBS, hubFor, isPageActive } from "@/lib/nav";
import { setTheme, usePrefs, type ThemePref } from "@/lib/prefs";
import { isTypingTarget, sequenceTarget } from "@/lib/shortcuts";
import { ShortcutsSheet } from "@/components/onboarding/shortcuts-sheet";
import { Tour } from "@/components/onboarding/tour";
import { useOnboarding, useStarterSeed } from "@/lib/onboarding/use-onboarding";

const HUB_ICON: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  companies: Building2,
  filings: FileSearch,
  markets: LineChart,
  signals: Crosshair,
  research: BookOpenText,
};

export function AppShell({
  children,
  isAdmin = false,
}: {
  children: ReactNode;
  isAdmin?: boolean;
}) {
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

  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const drawerWasOpen = useRef(false);
  // A route change closes the phone drawer; if it was open, focus goes back to the Menu button.
  useEffect(() => {
    if (!drawerWasOpen.current) return;
    setMobileOpen(false);
    menuButton.current?.focus();
  }, [pathname]);
  // Opening the phone drawer moves focus to the current page link (or the first link) inside it.
  useEffect(() => {
    drawerWasOpen.current = mobileOpen;
    if (!mobileOpen) return;
    const el = drawer.current;
    const link =
      el?.querySelector<HTMLElement>('a[aria-current="page"]') ??
      el?.querySelector<HTMLElement>("a[href]");
    link?.focus();
  }, [mobileOpen]);
  // Escape closes the phone drawer unless an open menu, dialog or panel handled the key. The check waits until the
  // event has reached every listener, so it does not depend on which window listener was registered first.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setTimeout(() => {
        if (e.defaultPrevented) return;
        setMobileOpen(false);
        menuButton.current?.focus();
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);
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
    if (
      onb.data?.seeded_at &&
      !onb.data.tour_done_at &&
      pathname === "/app" &&
      !sessionStorage.getItem("fu:tour-shown")
    ) {
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
    return () => {
      window.removeEventListener("fu:tour", t);
      window.removeEventListener("fu:shortcuts", k);
    };
  }, []);
  // Quick-start checklist ticks itself off as the user does each thing.
  const { tick } = onb;
  useEffect(() => {
    if (/^\/app\/companies\/[^/]+/.test(pathname)) tick("search");
    if (pathname.startsWith("/app/office/")) tick("office");
  }, [pathname, tick]);
  useEffect(() => {
    if (target) tick("source");
  }, [target, tick]);
  useEffect(() => {
    if (aiOpen) tick("assistant");
  }, [aiOpen, tick]);
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
        if (to) {
          e.preventDefault();
          void navigate({ to: to as never });
        }
        return;
      }
      if (e.key === "g" || e.key === "G") {
        pendingG = Date.now();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setKeysOpen(true);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setCmdOpen(true);
        return;
      }
      if (e.key === "[" || e.key === "]") {
        const tabs = Array.from(
          document.querySelectorAll<HTMLAnchorElement>("a[data-tour^='tab-']"),
        );
        const cur = tabs.findIndex(
          (a) => a.getAttribute("aria-current") === "page" || a.dataset.status === "active",
        );
        if (tabs.length && cur >= 0)
          tabs[(cur + (e.key === "]" ? 1 : -1) + tabs.length) % tabs.length]?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <aside
        id="app-sidebar"
        ref={drawer}
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-[transform,width,visibility] lg:translate-x-0",
          collapsed && "lg:w-16",
          mobileOpen ? "translate-x-0 shadow-lift" : "-translate-x-full max-lg:invisible",
        )}
      >
        <SidebarContent
          onSearch={() => setCmdOpen(true)}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          onClose={() => {
            setMobileOpen(false);
            menuButton.current?.focus();
          }}
          isAdmin={isAdmin}
        />
      </aside>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div
        className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-16" : "lg:pl-60")}
        style={target ? ({ "--panel": PANEL_WIDTH } as React.CSSProperties) : undefined}
      >
        <div
          className={cn(
            "transition-[padding] duration-300",
            target && "min-[1760px]:pr-[var(--panel)]",
            !target && aiOpen && aiDocked && "md:pr-[min(var(--assistant-w,420px),100vw)]",
          )}
        >
          <header className="@container sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:px-6">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              ref={menuButton}
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Menu"
              aria-expanded={mobileOpen}
              aria-controls="app-sidebar"
            >
              {mobileOpen ? <X /> : <Menu />}
            </Button>
            <Button
              variant="outline"
              onClick={() => setCmdOpen(true)}
              data-tour="search"
              aria-label="Search companies, filings and pages"
              className="h-9 w-full min-w-0 max-w-[420px] justify-start gap-2 rounded-lg bg-card pl-3 pr-2 text-[13px] font-normal text-muted-foreground"
            >
              <Search className="size-4" />
              <span className="flex-1 truncate text-left">Search companies, filings and pages</span>
              <kbd className="num rounded border bg-muted px-1.5 text-xs">⌘K</kbd>
            </Button>
            <MarketTape />
            <div className="ml-auto md:ml-0">
              <AlertsBell />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Help and guide"
                  title="Help and guide"
                >
                  <CircleHelp />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Help</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setTourOpen(true)}>
                  <Compass /> Take the tour
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setKeysOpen(true)}>
                  <Keyboard /> Keyboard shortcuts{" "}
                  <kbd className="num ml-auto text-xs opacity-70">?</kbd>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    window.dispatchEvent(
                      new CustomEvent("fu:research-request", {
                        detail:
                          "Show me around: what can I do in FiledUnder, and where should I start? Point at things on the page as you explain.",
                      }),
                    )
                  }
                >
                  <MessageCircleQuestion /> Ask the guide
                </DropdownMenuItem>
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
              <kbd className="num hidden rounded border px-1 text-xs opacity-70 md:inline">⌘J</kbd>
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
      <Tour
        open={tourOpen}
        onClose={() => {
          setTourOpen(false);
          if (!onb.data?.tour_done_at) void onb.patch({ tour_done_at: new Date().toISOString() });
        }}
      />
    </div>
  );
}

function SidebarContent({
  onSearch,
  collapsed,
  onToggle,
  onClose,
  isAdmin,
}: {
  onSearch: () => void;
  collapsed: boolean;
  onToggle: () => void;
  onClose: () => void;
  isAdmin: boolean;
}) {
  // Collapsing only applies on desktop; the phone drawer always shows labels.
  const lbl = collapsed ? "lg:hidden" : "";
  // Link names stay available to screen readers when folded; the `title` tooltip shows them on hover.
  const linkName = collapsed ? "lg:sr-only" : "";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const watch = useWatchlist();
  const universe = useUniverse();
  const tickers = (watch.data ?? []).map((w) => w.ticker);
  const quotes = useQuotes(tickers);
  const byTicker = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q]));

  const activeHub = hubFor(pathname)?.id;

  return (
    <>
      {/* The brand sits centered in the strip; the edge controls are absolutely placed so they never shift it. */}
      <div className="relative flex h-14 shrink-0 items-center justify-center border-b border-sidebar-border">
        <Link to="/app" className={cn("flex items-center rounded-md", collapsed && "lg:hidden")}>
          <Logo size="md" className="brand-on-surface" />
        </Link>
        {collapsed && (
          <button
            onClick={onToggle}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="brand-on-surface hidden size-10 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent lg:flex"
          >
            <BrandMark title="" className="h-6" />
          </button>
        )}
        <button
          onClick={onToggle}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className={cn(
            "absolute right-2 top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex",
            collapsed && "lg:hidden",
          )}
        >
          <PanelLeftClose className="size-[18px]" strokeWidth={1.75} />
        </button>
        <button
          onClick={onClose}
          aria-label="Close menu"
          title="Close menu"
          className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
        >
          <X className="size-[18px]" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <nav aria-label="Pages" className="px-2 py-3">
          <ul className="flex flex-col gap-0.5">
            {SIDEBAR_HUBS.map((hub) => {
              const Icon = HUB_ICON[hub.id] ?? LayoutDashboard;
              const active = activeHub === hub.id;
              return (
                <li key={hub.id}>
                  <Link
                    to={hub.pages[0].to}
                    data-tour={`hub-${hub.id}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      active && "bg-sidebar-accent font-medium text-sidebar-foreground",
                      collapsed && "lg:justify-center lg:px-0",
                    )}
                    title={collapsed ? hub.label : undefined}
                  >
                    <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
                    <span className={cn("truncate", linkName)}>{hub.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <section aria-label="Watchlist" className="border-t border-sidebar-border px-2 pb-3 pt-2">
          <div className={cn("flex h-8 items-center justify-between pl-3 pr-1", lbl)}>
            <h2 className="text-xs font-normal text-muted-foreground">Watchlist</h2>
            <button
              onClick={onSearch}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Add
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
                    <CompanyLogo ticker={t} src={u?.logo} size="xs" decorative />
                    <span className={cn("num font-medium", linkName)}>{t}</span>
                    <span className={cn("num ml-auto text-xs text-muted-foreground", lbl)}>
                      {q ? fmtPrice(q.price) : ""}
                    </span>
                    {q && (
                      <span
                        className={cn(
                          "num w-12 text-right text-xs",
                          lbl,
                          q.changePct >= 0 ? "text-positive" : "text-negative",
                        )}
                      >
                        {fmtPct(q.changePct, 1, true)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
            {!tickers.length && !watch.isLoading && (
              <li className={cn("px-3 text-xs text-muted-foreground", lbl)}>
                Follow a company to see it here.
              </li>
            )}
          </ul>
        </section>
      </div>
      <UserMenu collapsed={collapsed} isAdmin={isAdmin} />
    </>
  );
}

const MENU_ITEM = "h-9 gap-2.5 rounded-md px-2 text-[13px] [&>svg]:text-muted-foreground";

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function UserMenu({ collapsed, isAdmin }: { collapsed: boolean; isAdmin: boolean }) {
  const me = useProfile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const name = me.data?.profile?.display_name || me.data?.user.email?.split("@")[0] || "Analyst";
  const email = me.data?.user.email ?? "";
  const { firms, firm, setActive } = useFirm();
  const [prefs] = usePrefs();
  const secondary = firm ? firm.name : email || "Signed in";
  const initial = name.slice(0, 1).toUpperCase();

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="shrink-0 border-t border-sidebar-border p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Account menu, ${name}`}
            title={collapsed ? "Account" : undefined}
            className={cn(
              "flex h-12 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
              collapsed && "lg:justify-center lg:px-0",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-medium text-primary-foreground">
              {initial}
            </span>
            <span className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
              <span className="block truncate text-[13px] font-medium text-sidebar-foreground">
                {name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
            </span>
            <ChevronsUpDown
              className={cn("size-4 shrink-0 text-muted-foreground", collapsed && "lg:hidden")}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-[264px] rounded-xl p-1.5 shadow-lift"
        >
          <DropdownMenuLabel className="flex items-center gap-2.5 px-2 pb-2.5 pt-2 font-normal">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
              {initial}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-popover-foreground">
                {name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
            </span>
          </DropdownMenuLabel>
          {firms.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2 text-xs font-normal text-muted-foreground">
                Switch firm
              </DropdownMenuLabel>
              {firms.map((f) => (
                <DropdownMenuItem key={f.id} className={MENU_ITEM} onClick={() => setActive(f.id)}>
                  <Check
                    className={cn("size-4", f.id === firm?.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{f.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className={MENU_ITEM}>
            <Link to="/app/settings" hash="profile">
              <UserRound /> Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={MENU_ITEM}>
            <Link to="/app/settings">
              <SlidersHorizontal /> Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className={MENU_ITEM}>
            <Link to="/app/firm">
              <Users /> {firm ? "Firm workspace" : "Create a firm"}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={MENU_ITEM}>
            <Link to="/app/billing">
              <CreditCard /> Plan and billing
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem asChild className={MENU_ITEM}>
              <Link to="/app/admin">
                <ShieldCheck /> Admin
                <span aria-hidden="true" className="ml-auto text-xs text-muted-foreground">
                  Admins only
                </span>
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel
            id="account-theme-label"
            className="px-2 text-xs font-normal text-muted-foreground"
          >
            Theme
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-labelledby="account-theme-label"
            value={prefs.theme}
            onValueChange={(v) => setTheme(v as ThemePref)}
          >
            {THEME_OPTIONS.map((o) => (
              <DropdownMenuRadioItem
                key={o.value}
                value={o.value}
                className="h-9 rounded-md pr-2 text-[13px]"
                onSelect={(e) => e.preventDefault()}
              >
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={MENU_ITEM} onClick={signOut}>
            <LogOut /> Sign out
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
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <Activity className="size-3" />
        {!q.data ? "Markets" : q.data.quotes.some((x) => "snapshot" in x) ? "Last close" : "Live"}
      </span>
      {(q.data?.quotes ?? []).map((x, i) => (
        <Link
          key={x.symbol}
          to="/app/markets"
          search={{ symbol: x.symbol }}
          className={cn(
            "num hidden items-baseline gap-1.5 whitespace-nowrap text-xs",
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
    <nav
      aria-label={hub.label}
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b scrollbar-thin"
    >
      {hub.pages.map((p) => {
        const active = isPageActive(p, pathname);
        return (
          <Link
            key={p.to}
            to={p.to}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
