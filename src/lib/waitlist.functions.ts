// Waitlist and app-email server functions. Public: joinWaitlist. Admin-only: the rest (role checked first).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { approvalLink, rateLimit, SITE_URL, waitlistSchema } from "@/lib/email/core";

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export type JoinResult = { ok: true } | { ok: false; error: string };

export const joinWaitlist = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => input)
  .handler(async ({ data }): Promise<JoinResult> => {
    const parsed = waitlistSchema.safeParse(data);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
    const v = parsed.data;
    if (v.website) return { ok: true }; // honeypot: look successful, store nothing
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ip = getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = await sha256(`fu-waitlist:${ip}`);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hour = new Date(Date.now() - 3_600_000).toISOString();
    const day = new Date(Date.now() - 86_400_000).toISOString();
    const [ipC, emC] = await Promise.all([
      supabaseAdmin.from("waitlist_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", hour),
      supabaseAdmin.from("waitlist_attempts").select("id", { count: "exact", head: true }).eq("email", v.email).gte("created_at", day),
    ]);
    const rl = rateLimit(ipC.count ?? 0, emC.count ?? 0);
    await supabaseAdmin.from("waitlist_attempts").insert({ ip_hash: ipHash, email: v.email });
    if (!rl.ok) return { ok: false, error: "Too many attempts. Please try again in an hour." };

    const { data: row } = await supabaseAdmin
      .from("waitlist_requests")
      .upsert({ email: v.email, name: v.name, firm: v.firm ?? null, role: v.role ?? null, use_case: v.useCase ?? null }, { onConflict: "email", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (!row) return { ok: true }; // already on the list: same confirmation, no new emails

    const { queueEmail, adminEmails } = await import("@/lib/email/outbox.server");
    await queueEmail({ template: "waitlist-receipt", to: v.email, relatedTable: "waitlist_requests", relatedId: row.id, state: "joined", data: { name: v.name } });
    for (const admin of await adminEmails()) {
      await queueEmail({
        template: "waitlist-owner-notice", to: admin, relatedTable: "waitlist_requests", relatedId: row.id, state: "joined",
        data: { name: v.name, email: v.email, firm: v.firm, role: v.role, useCase: v.useCase, adminUrl: `${SITE_URL}/app/admin` },
      });
    }
    return { ok: true };
  });

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Admins only");
}

export type EmailState = { status: string; at: string; id: string } | null;
export interface AdminEntry {
  kind: "account" | "request";
  id: string;
  email: string | null;
  name: string | null;
  firm: string | null;
  role: string | null;
  useCase: string | null;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  decidedAt: string | null;
  emails: { receipt: EmailState; approval: EmailState; reminder: EmailState };
}

export const listAdminWaitlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminEntry[]> => {
    await assertAdmin(context);
    const sb = context.supabase;
    const [acc, req, log] = await Promise.all([
      sb.from("waitlist").select("user_id,email,display_name,status,created_at,decided_at").order("created_at", { ascending: false }),
      sb.from("waitlist_requests").select("*").is("user_id", null).order("created_at", { ascending: false }),
      sb.from("email_log").select("id,template,related_table,related_id,status,updated_at,sent_at").in("template", ["waitlist-receipt", "waitlist-approved", "waitlist-reminder"]).order("updated_at", { ascending: true }).limit(5000),
    ]);
    if (acc.error) throw new Error(acc.error.message);
    const latest = new Map<string, EmailState>();
    for (const l of log.data ?? []) latest.set(`${l.related_table}:${l.related_id}:${l.template}`, { status: l.status, at: l.sent_at ?? l.updated_at, id: l.id });
    const em = (table: string, id: string) => ({
      receipt: latest.get(`${table}:${id}:waitlist-receipt`) ?? null,
      approval: latest.get(`${table}:${id}:waitlist-approved`) ?? null,
      reminder: latest.get(`${table}:${id}:waitlist-reminder`) ?? null,
    });
    const accounts: AdminEntry[] = (acc.data ?? []).map((r: any) => ({
      kind: "account", id: r.user_id, email: r.email, name: r.display_name, firm: null, role: null, useCase: null,
      status: r.status, createdAt: r.created_at, decidedAt: r.decided_at, emails: em("waitlist", r.user_id),
    }));
    const requests: AdminEntry[] = (req.data ?? []).map((r: any) => ({
      kind: "request", id: r.id, email: r.email, name: r.name, firm: r.firm, role: r.role, useCase: r.use_case,
      status: r.status, createdAt: r.created_at, decidedAt: r.decided_at, emails: em("waitlist_requests", r.id),
    }));
    return [...requests, ...accounts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

const target = z.object({ kind: z.enum(["account", "request"]), id: z.string().uuid() });

export const decideWaitlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { items: { kind: "account" | "request"; id: string }[]; status: "approved" | "declined" | "pending" }) =>
    z.object({ items: z.array(target).min(1).max(200), status: z.enum(["approved", "declined", "pending"]) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { queueEmail } = await import("@/lib/email/outbox.server");
    const results: Record<string, number> = {};
    for (const it of data.items) {
      let email: string | null = null, name: string | null = null, decidedAt = "", hasAccount = it.kind === "account";
      if (it.kind === "account") {
        const { error } = await context.supabase.rpc("decide_waitlist", { _user: it.id, _status: data.status });
        if (error) throw new Error(error.message);
        const { data: r } = await supabaseAdmin.from("waitlist").select("email,display_name,decided_at").eq("user_id", it.id).maybeSingle();
        email = r?.email ?? null; name = r?.display_name ?? null; decidedAt = r?.decided_at ?? "";
      } else {
        const now = new Date().toISOString();
        const { data: r, error } = await supabaseAdmin.from("waitlist_requests")
          .update({ status: data.status, decided_at: now, decided_by: context.userId }).eq("id", it.id)
          .select("email,name,decided_at").maybeSingle();
        if (error) throw new Error(error.message);
        email = r?.email ?? null; name = r?.name ?? null; decidedAt = r?.decided_at ?? now;
        if (email) {
          const { data: users } = await supabaseAdmin.from("waitlist").select("user_id").eq("email", email).limit(1);
          hasAccount = !!users?.length;
        }
      }
      if (data.status === "approved" && email) {
        const s = await queueEmail({
          template: "waitlist-approved", to: email, relatedTable: it.kind === "account" ? "waitlist" : "waitlist_requests", relatedId: it.id,
          state: `approved:${decidedAt}`, data: { name, email, hasAccount, link: approvalLink(email, hasAccount) },
        });
        results[s] = (results[s] ?? 0) + 1;
      }
    }
    return { emails: results };
  });

export const resendWaitlistEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { logId: string }) => z.object({ logId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: l } = await supabaseAdmin.from("email_log").select("*").eq("id", data.logId).maybeSingle();
    if (!l) throw new Error("Email not found");
    const { queueEmail } = await import("@/lib/email/outbox.server");
    // A deliberate resend is a new state; the minute bucket absorbs double clicks.
    const status = await queueEmail({
      template: l.template as never, to: l.recipient, relatedTable: l.related_table ?? "", relatedId: l.related_id ?? "",
      state: `resend:${Math.floor(Date.now() / 60_000)}`, data: (l.template_data ?? {}) as Record<string, unknown>,
    });
    return { status };
  });

export const emailFirmInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { inviteId: string }) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // RLS decides whether this user may see the invite (firm admins only).
    const { data: inv } = await context.supabase.from("firm_invites").select("id,email,role,token,firm_id,created_at").eq("id", data.inviteId).maybeSingle();
    if (!inv) throw new Error("Invite not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: firm }, { data: me }] = await Promise.all([
      supabaseAdmin.from("firms").select("name").eq("id", inv.firm_id).maybeSingle(),
      supabaseAdmin.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
    ]);
    const { queueEmail } = await import("@/lib/email/outbox.server");
    const status = await queueEmail({
      template: "firm-invite", to: inv.email, relatedTable: "firm_invites", relatedId: inv.id, state: `invite:${inv.created_at}`,
      data: { firmName: firm?.name, inviterName: me?.display_name, role: inv.role, email: inv.email, link: `${SITE_URL}/app/join/${inv.token}` },
    });
    return { status };
  });
