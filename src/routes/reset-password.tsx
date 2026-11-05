import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Reset password — Filed Under" },
      { name: "description", content: "Choose a new password for your Filed Under account." },
      { property: "og:title", content: "Reset password — Filed Under" },
      { property: "og:description", content: "Choose a new password for your Filed Under account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isRecovery = window.location.hash.includes("type=recovery");
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session && isRecovery) setReady(true);
      else if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    toast.success("Password updated");
    navigate({ to: "/app", replace: true });
  };

  return (
    <div className="paper-grain flex min-h-screen flex-col items-center justify-center px-6">
      <Link to="/">
        <Logo />
      </Link>
      <div className="mt-10 w-full max-w-sm rounded-lg border bg-card p-6 shadow-paper">
        <h1 className="font-display text-3xl">Set a new password</h1>
        {!ready ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Open this page from the reset link in your email. If the link expired,{" "}
            <Link to="/auth" search={{ mode: "forgot" }} className="text-link underline">
              request a new one
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={submit} className="mt-5 grid grid-cols-1 gap-3.5">
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="pw2">Confirm password</Label>
              <Input id="pw2" type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && <p className="text-sm text-negative">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Update password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
