import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => data.subscription.unsubscribe();
  }, []);
  return signedIn;
}

export function SiteHeader({ className }: { className?: string }) {
  const signedIn = useSignedIn();
  return (
    <header className={cn("sticky top-0 z-30 border-b border-transparent bg-background/80 backdrop-blur-md", className)}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        <Link to="/" aria-label="Filed Under home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link to="/" hash="product" className="transition-colors hover:text-foreground">
            Product
          </Link>
          <Link to="/" hash="sources" className="transition-colors hover:text-foreground">
            Sources
          </Link>
          <Link to="/research" className="transition-colors hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            Research
          </Link>
          <Link to="/companies" className="transition-colors hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            Companies
          </Link>
          <Link to="/pricing" className="transition-colors hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            Pricing
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <Button asChild>
              <Link to="/app">
                Open workspace <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild className="hidden sm:inline-flex">
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button asChild>
                <Link to="/auth" search={{ mode: "signup" }}>Join the waitlist</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto grid grid-cols-1 max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            Source-linked research on US public companies. Built on SEC EDGAR, Yahoo Finance and FRED.
          </p>
        </div>
        <FooterCol
          title="Product"
          links={[
            { label: "Financials", to: "/" },
            { label: "Research", to: "/research" },
            { label: "Companies", to: "/companies" },
            { label: "Pricing", to: "/pricing" },
            { label: "Sign in", to: "/auth" },
          ]}
        />
        <div>
          <p className="eyebrow">Primary sources</p>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              ["SEC EDGAR", "https://www.sec.gov/edgar/search/"],
              ["XBRL frames API", "https://www.sec.gov/search-filings/edgar-application-programming-interfaces"],
              ["FRED", "https://fred.stlouisfed.org"],
              ["Yahoo Finance", "https://finance.yahoo.com"],
            ].map(([l, h]) => (
              <li key={l}>
                <a href={h} target="_blank" rel="noreferrer" className="text-muted-foreground transition-colors hover:text-foreground">
                  {l}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Disclosures</p>
          <p className="mt-3 text-sm text-muted-foreground">
            For research and education. Not investment advice. Market data may be delayed.
          </p>
        </div>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Filed Under · filedunder.ai</span>
          <span className="num">EDGAR · XBRL · iXBRL · FORM 4 · FRED</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; to: "/" | "/pricing" | "/auth" | "/companies" | "/research" }[] }) {
  return (
    <div>
      <p className="eyebrow">{title}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link to={l.to} className="text-muted-foreground transition-colors hover:text-foreground">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
