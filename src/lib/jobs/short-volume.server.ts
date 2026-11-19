import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { COVERAGE } from "@/lib/coverage";
import { FINRA_SHORT_URL, parseShortVolume } from "@/lib/signals/finra";

/** One complete session per invocation. Only advance after the entire idempotent upsert succeeds. */
export async function refreshShortVolume() {
  const { data: state, error: stateError } = await supabaseAdmin.from("job_state").select("cursor").eq("job", "short-volume").maybeSingle();
  if (stateError) throw new Error(stateError.message);
  let last = state?.cursor ? String(state.cursor).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") : null;
  if (!last) {
    const { data, error } = await supabaseAdmin.from("short_volume").select("date").order("date", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    last = data?.[0]?.date ?? null;
  }
  // SPY's stored bar dates are the existing exchange-session calendar, including holidays.
  // Start at the latest known session only for an empty installation; otherwise catch up in order.
  const { data: sessions, error: sessionError } = await supabaseAdmin.from("market_bars").select("date").eq("symbol", "SPY")
    .gt("date", last ?? "1900-01-01").lte("date", new Date().toISOString().slice(0, 10)).order("date", { ascending: !!last }).limit(1);
  if (sessionError) throw new Error(sessionError.message);
  const day = sessions?.[0]?.date;
  if (!day) return { ok: true, items: 0, detail: { through: last, idle: true } };
  const res = await fetch(FINRA_SHORT_URL(day), { signal: AbortSignal.timeout(1200) });
  if (res.status === 403 || res.status === 404) return { ok: true, items: 0, detail: { pending: day, note: "FINRA file not published; retry next run" } };
  if (!res.ok) throw new Error(`FINRA ${day}: HTTP ${res.status}`);
  const rows = parseShortVolume(await res.text(), new Set(COVERAGE.map(c => c.ticker)));
  if (!rows.length || rows.some(r => r.date !== day)) throw new Error(`FINRA ${day}: empty or mismatched file`);
  const { error } = await supabaseAdmin.from("short_volume").upsert(rows, { onConflict: "symbol,date" });
  if (error) throw new Error(error.message);
  const { error: cursorError } = await supabaseAdmin.from("job_state").upsert({ job: "short-volume", cursor: Number(day.replaceAll("-", "")), updated_at: new Date().toISOString() });
  if (cursorError) throw new Error(cursorError.message);
  return { ok: true, items: rows.length, detail: { date: day, prior: last } };
}