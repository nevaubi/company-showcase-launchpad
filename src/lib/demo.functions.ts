import { createServerFn } from "@tanstack/react-start";

export const DEMO_EMAIL = "demo@filedunder.ai";

/**
 * Public: ensures the shared demo account exists, then returns a one-time
 * magic-link token hash that the browser exchanges for a session with
 * supabase.auth.verifyOtp. No password is ever exposed.
 */
export const startDemoSession = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { seedDemoWorkspace } = await import("@/lib/demo.server");

  const password = crypto.randomUUID() + crypto.randomUUID();
  const created = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Demo Analyst", is_demo: true },
  });
  if (created.data.user) {
    await seedDemoWorkspace(supabaseAdmin, created.data.user.id);
  } else if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    throw new Error(`Could not prepare the demo account: ${created.error.message}`);
  }

  const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: DEMO_EMAIL });
  if (link.error || !link.data.properties?.hashed_token) {
    throw new Error(link.error?.message ?? "Could not start a demo session");
  }
  return { tokenHash: link.data.properties.hashed_token, email: DEMO_EMAIL };
});
