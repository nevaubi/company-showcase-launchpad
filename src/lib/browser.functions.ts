// Server functions behind the assistant's in-panel browser (Browser Use Cloud).
// Every run handle carries an HMAC of (run id, user id) keyed on the server secret, so a signed-in
// user can only read, list files of, or stop runs they started. The API key never reaches the client.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function sign(runId: string, userId: string) {
  const { browserUseKey } = await import("@/lib/browser-use.server");
  const secret = browserUseKey();
  if (!secret) throw new Error("Browser Use is not configured (set BROWSER_USE_API_KEY)");
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(`fu-browser:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`${runId}:${userId}`)));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verify(handle: { id: string; token: string }, userId: string) {
  const want = await sign(handle.id, userId);
  if (want.length !== handle.token.length) throw new Error("Unknown browser task");
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ handle.token.charCodeAt(i);
  if (diff) throw new Error("Unknown browser task");
}

const Handle = z.object({ id: z.string().min(8).max(80).regex(/^[A-Za-z0-9-]+$/), token: z.string().length(32) });

export const browserConfigured = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { browserUseKey } = await import("@/lib/browser-use.server");
    return { configured: !!browserUseKey() };
  });

/** Start one or more browser agents in parallel. */
export const browserStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tasks: z
          .array(
            z.object({
              goal: z.string().min(4).max(2000),
              start_url: z.string().url().max(2000).nullable().optional(),
              screenshot: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(4),
        mode: z.enum(["fast", "thorough"]).default("fast"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { createRun } = await import("@/lib/browser-use.server");
    const out = await Promise.all(
      data.tasks.map(async (t) => {
        try {
          const r = await createRun({ goal: t.goal, startUrl: t.start_url ?? null, mode: data.mode, screenshot: t.screenshot });
          return { id: r.id, token: await sign(r.id, context.userId), goal: t.goal, status: r.status, workspaceId: r.workspaceId };
        } catch (e) {
          return { id: "", token: "", goal: t.goal, status: "error", error: (e as Error).message };
        }
      }),
    );
    return { runs: out };
  });

export const browserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runs: z.array(Handle).min(1).max(6) }).parse(d))
  .handler(async ({ data, context }) => {
    const { getRun } = await import("@/lib/browser-use.server");
    const runs = await Promise.all(
      data.runs.map(async (h) => {
        try {
          await verify(h, context.userId);
          return { ...(await getRun(h.id)), token: h.token };
        } catch (e) {
          return { id: h.id, token: h.token, status: "error", done: true, error: (e as Error).message };
        }
      }),
    );
    return { runs };
  });

export const browserFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Handle.parse(d))
  .handler(async ({ data, context }) => {
    await verify(data, context.userId);
    const { getRun, listRunFiles } = await import("@/lib/browser-use.server");
    const run = await getRun(data.id);
    const files = await listRunFiles({ workspaceId: run.workspaceId, browserSessionId: run.browserSessionId });
    // Presigned URLs expire within a minute and may not allow browser CORS, so small files come back
    // inline (base64), up to 5 MB each and 12 MB per call; larger ones keep the short-lived URL.
    let budget = 12_000_000;
    const out = await Promise.all(
      files.map(async (f) => {
        if (!f.url || f.size > 5_000_000 || f.size > budget) return { ...f, data: null as string | null };
        budget -= f.size;
        try {
          const res = await fetch(f.url);
          if (!res.ok) return { ...f, data: null };
          const bytes = new Uint8Array(await res.arrayBuffer());
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return { ...f, data: btoa(bin) };
        } catch {
          return { ...f, data: null };
        }
      }),
    );
    return { files: out };
  });

export const browserStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Handle.parse(d))
  .handler(async ({ data, context }) => {
    await verify(data, context.userId);
    const { cancelRun } = await import("@/lib/browser-use.server");
    return cancelRun(data.id);
  });
