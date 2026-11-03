import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startDemoSession } from "@/lib/demo.functions";

/** One-click sign-in to the shared demo account. */
export function useDemoSignIn() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  const signIn = async (to = "/app") => {
    setPending(true);
    try {
      const { tokenHash } = await startDemoSession();
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (error) throw error;
      toast.success("Signed in to the demo workspace");
      await navigate({ to, replace: true });
    } catch (e) {
      toast.error("Couldn't open the demo", { description: (e as Error).message });
    } finally {
      setPending(false);
    }
  };

  return { signIn, pending };
}
