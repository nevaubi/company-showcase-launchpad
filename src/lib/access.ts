import { supabase } from "@/integrations/supabase/client";

export type Access = { approved: boolean; admin: boolean; status: "pending" | "approved" | "declined" | null };

/** Reads the signed-in user's waitlist status and admin role from the database (RLS + security-definer checks). */
export async function fetchAccess(userId: string): Promise<Access> {
  const [ok, adm, wl] = await Promise.all([
    supabase.rpc("has_app_access", { _user: userId }),
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.from("waitlist").select("status").eq("user_id", userId).maybeSingle(),
  ]);
  return {
    approved: !!ok.data,
    admin: !!adm.data,
    status: (wl.data?.status as Access["status"]) ?? null,
  };
}
