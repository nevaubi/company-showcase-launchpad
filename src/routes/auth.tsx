import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowRight, Loader2, MailCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import "@lovable.dev/cloud-auth-js/styles.css";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useDemoSignIn } from "@/hooks/use-demo-sign-in";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const searchSchema = z.object({
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup", "forgot"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Filed Under" },
      { name: "description", content: "Sign in to Filed Under, or open the demo workspace with live SEC, market and macro data." },
      { property: "og:title", content: "Sign in — Filed Under" },
      { property: "og:description", content: "Source-linked equity research. Sign in or try the demo workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function safeRedirect(r?: string) {
  if (!r) return "/app";
  try {
    const u = new URL(r, window.location.origin);
    if (u.origin !== window.location.origin) return "/app";
    const path = u.pathname + u.search + u.hash;
    return path.startsWith("/auth") ? "/app" : path;
  } catch {
    return r.startsWith("/") && !r.startsWith("//") ? r : "/app";
  }
}

/** Plain-language versions of the auth service's error strings. */
function authMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/invalid login credentials/i.test(m)) return "That email and password don't match an account.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first — check your inbox for the link we sent.";
  if (/already registered|already exists/i.test(m)) return "An account with this email already exists. Sign in instead.";
  if (/password should be at least|weak password/i.test(m)) return "Choose a stronger password — at least 8 characters, mixing letters and numbers.";
  if (/pwned|leaked|compromised/i.test(m)) return "This password has appeared in a data breach. Please choose a different one.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a minute and try again.";
  if (/unable to validate email|invalid email/i.test(m)) return "Enter a valid email address.";
  return m;
}

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<{ kind: "confirm" | "reset"; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demo = useDemoSignIn();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const stored = sessionStorage.getItem("fu:post-auth");
      sessionStorage.removeItem("fu:post-auth");
      navigate({ to: stored ?? safeRedirect(search.redirect), replace: true });
    });
  }, [navigate, search.redirect]);

  const go = () => navigate({ to: safeRedirect(search.redirect), replace: true });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("form");
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
        await go();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/auth", data: { display_name: name || undefined } },
        });
        if (error) throw error;
        if (data.session) await go();
        else setSentTo({ kind: "confirm", email });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setSentTo({ kind: "reset", email });
      }
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const oauth = async (provider: "google" | "lovable") => {
    setError(null);
    setBusy(provider);
    try {
      if (search.redirect) sessionStorage.setItem("fu:post-auth", safeRedirect(search.redirect));
      const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/auth" });
      if (result.error) throw result.error;
      if (result.redirected) return;
      const stored = sessionStorage.getItem("fu:post-auth");
      sessionStorage.removeItem("fu:post-auth");
      await navigate({ to: stored ?? safeRedirect(search.redirect), replace: true });
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="paper-grain flex flex-col px-6 py-8 sm:px-12">
        <Link to="/" className="w-fit">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          {sentTo ? (
            <div className="animate-rise">
              <MailCheck className="size-8" />
              <h1 className="mt-5 font-display text-4xl">Check your inbox</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                {sentTo.kind === "confirm"
                  ? `We sent a confirmation link to ${sentTo.email}. Open it to activate your account.`
                  : `If an account exists for ${sentTo.email}, a password reset link is on its way.`}
              </p>
              <Button variant="outline" className="mt-8" onClick={() => (setSentTo(null), setMode("signin"))}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <div className="animate-rise">
              <p className="eyebrow">{mode === "signup" ? "Create account" : mode === "forgot" ? "Reset password" : "Sign in"}</p>
              <h1 className="mt-3 font-display text-[2.6rem] leading-[1.05]">
                {mode === "signup" ? (
                  <>
                    Start your <em>research file</em>
                  </>
                ) : mode === "forgot" ? (
                  <>Forgot your password?</>
                ) : (
                  <>
                    Welcome back to the <em>archive</em>
                  </>
                )}
              </h1>

              {mode !== "forgot" && (
                <>
                  <Button
                    variant="highlight"
                    size="lg"
                    className="mt-8 w-full justify-between"
                    disabled={demo.pending}
                    onClick={() => demo.signIn(safeRedirect(search.redirect))}
                  >
                    <span className="flex items-center gap-2">
                      {demo.pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      Open the demo workspace
                    </span>
                    <ArrowRight />
                  </Button>
                  <p className="mt-2 text-center text-xs text-muted-foreground">No signup — a shared analyst account with sample theses.</p>

                  <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <Button variant="outline" size="lg" onClick={() => oauth("google")} disabled={!!busy}>
                      {busy === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
                      Continue with Google
                    </Button>
                    <button type="button" className="lovable-auth-button" onClick={() => oauth("lovable")} disabled={!!busy}>
                      Continue with Lovable
                    </button>
                  </div>
                </>
              )}

              <form onSubmit={onSubmit} className="mt-6 grid grid-cols-1 gap-3.5">
                {mode === "signup" && (
                  <div className="grid grid-cols-1 gap-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Analyst" autoComplete="name" />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@fund.com"
                    autoComplete="email"
                  />
                </div>
                {mode !== "forgot" && (
                  <div className="grid grid-cols-1 gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      {mode === "signin" && (
                        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode("forgot")}>
                          Forgot?
                        </button>
                      )}
                    </div>
                    <Input
                      id="password"
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    />
                  </div>
                )}
                {error && <p className="rounded-md border border-negative/30 bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
                <Button type="submit" size="lg" disabled={busy === "form"} className="mt-1">
                  {busy === "form" && <Loader2 className="animate-spin" />}
                  {mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {mode === "signin" ? (
                  <>
                    New here?{" "}
                    <button className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => setMode("signup")}>
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => setMode("signin")}>
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Data from SEC EDGAR, Yahoo Finance and FRED. Not investment advice.</p>
      </div>

      <AuthAside />
    </div>
  );
}

function AuthAside() {
  return (
    <div className="relative hidden overflow-hidden bg-ink text-ink-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="ruled pointer-events-none absolute inset-0 opacity-[0.06]" />
      <p className="eyebrow relative !text-ink-muted">Apple Inc. · Form 10-K · filed Oct 31, 2025</p>
      <div className="relative">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Consolidated statements of operations</p>
        <table className="num mt-4 w-full max-w-lg text-[15px]">
          <thead>
            <tr className="border-b border-ink-foreground/15 text-left text-[11px] uppercase tracking-wider text-ink-muted">
              <th className="py-2 font-normal">In millions</th>
              <th className="py-2 text-right font-normal">FY2025</th>
              <th className="py-2 text-right font-normal">FY2024</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Net sales", "416,161", "391,035", true],
              ["Gross margin", "195,201", "180,683", false],
              ["Operating income", "133,050", "123,216", false],
              ["Net income", "112,010", "93,736", false],
            ].map(([k, a, b, hl]) => (
              <tr key={k as string} className="border-b border-ink-foreground/10">
                <td className="py-2.5 font-sans">{k}</td>
                <td className="py-2.5 text-right">
                  <span className={hl ? "rounded-sm bg-highlight px-1 text-highlight-foreground" : ""}>{a}</span>
                </td>
                <td className="py-2.5 text-right text-ink-muted">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 max-w-md font-display text-3xl leading-tight">
          “Every figure opens the filing it came from — scrolled to the line, highlighted.”
        </p>
      </div>
      <p className="relative text-xs text-ink-muted">us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax · accession 0000320193-25-000079</p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
