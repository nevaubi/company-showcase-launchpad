import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Signed in AND allowed into the product (approved waitlist, admin or demo).
 * Use on every server function that returns research data or spends AI credits,
 * so the waiting list holds even when the server is called directly.
 */
export const requireAppAccess = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("has_app_access", { _user: context.userId });
    if (error || !data) throw new Response("Forbidden: waiting list", { status: 403 });
    return next();
  });
