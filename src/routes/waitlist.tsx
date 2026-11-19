import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { joinWaitlist } from "@/lib/waitlist.functions";

const TITLE = "Join the waitlist · FiledUnder";
const DESC = "Request access to FiledUnder, US equity research where every number links to its SEC source.";

export const Route = createFileRoute("/waitlist")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WaitlistPage,
});

function WaitlistPage() {
  const join = useServerFn(joinWaitlist);
  const [f, setF] = useState({ name: "", email: "", firm: "", role: "", useCase: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await join({ data: f });
      if (r.ok) setDone(f.email.trim());
      else setError(r.error);
    } catch {
      setError("Something went wrong. Please try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="paper-grain flex min-h-screen flex-col items-center px-6 py-12">
      <Link to="/" aria-label="FiledUnder home"><Logo /></Link>
      <main className="mt-10 w-full max-w-md">
        {done ? (
          <div className="text-center" role="status">
            <MailCheck className="mx-auto size-8 text-muted-foreground" />
            <h1 className="mt-4 font-display text-xl">You're on the list</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Thanks. We've received your request for {done}. We review every request by hand and usually reply within a week. If you're approved, we'll email a link to create your account with this address.
            </p>
            <Button asChild variant="outline" className="mt-6"><Link to="/">Back to FiledUnder</Link></Button>
          </div>
        ) : (
          <>
            <p className="eyebrow">Waitlist</p>
            <h1 className="mt-3 font-display text-xl">Request access to FiledUnder</h1>
            <p className="mt-2 text-sm text-muted-foreground">We open access to analysts in small groups. Tell us a little about you.</p>
            <form onSubmit={onSubmit} className="mt-6 grid grid-cols-1 gap-3.5" noValidate>
              <div className="grid grid-cols-1 gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" required maxLength={100} value={f.name} onChange={set("name")} autoComplete="name" />
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" type="email" required maxLength={255} value={f.email} onChange={set("email")} placeholder="you@fund.com" autoComplete="email" />
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div className="grid min-w-0 grid-cols-1 gap-1.5">
                  <Label htmlFor="firm">Firm <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="firm" maxLength={120} value={f.firm} onChange={set("firm")} autoComplete="organization" />
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-1.5">
                  <Label htmlFor="role">Role <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="role" maxLength={80} value={f.role} onChange={set("role")} autoComplete="organization-title" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <Label htmlFor="useCase">What do you want to use it for? <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea id="useCase" rows={3} maxLength={500} value={f.useCase} onChange={set("useCase")} />
              </div>
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="website">Website</label>
                <input id="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
              </div>
              {error && <p role="alert" className="rounded-md border border-negative/30 bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
              <Button type="submit" size="lg" disabled={busy} className="mt-1">
                {busy && <Loader2 className="animate-spin" />}
                Join the waitlist
              </Button>
              <p className="text-xs text-muted-foreground">
                By joining, you agree that FiledUnder may email you about your request and to our <Link to="/terms" className="underline">terms</Link> and <Link to="/privacy" className="underline">privacy policy</Link>. We only use these details to review your access.
              </p>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already approved? <Link to="/auth" className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
