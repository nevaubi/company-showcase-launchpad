// Re-matches every tagged customer/supplier name in xbrl_concentration to a covered ticker with the
// current matcher (src/lib/xbrl/counterparty.ts), so improving the matcher doesn't need a full rebuild.
//   bun scripts/xbrl-rematch.ts [--dry]
import { companyMatcher } from "@/lib/xbrl/counterparty";
import { args, dbGate, log, sb } from "./lib/supa";

async function main() {
  const { data: uni } = await sb.storage.from("datasets").download("universe.json");
  const u = JSON.parse(await uni!.text()) as { companies?: { ticker: string; name: string }[] } | { ticker: string; name: string }[];
  const match = companyMatcher(Array.isArray(u) ? u : (u.companies ?? []));
  const rows: { id: number; ticker: string; label: string; counterparty: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    await dbGate();
    const { data, error } = await sb.from("xbrl_concentration").select("id, ticker, label, counterparty").in("kind", ["customer", "supplier"]).order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const changes = rows.map((r) => ({ ...r, next: match(r.label, r.ticker) })).filter((r) => r.next !== r.counterparty);
  log(`${rows.length} tagged customer/supplier rows · ${changes.length} change`);
  const byLabel = new Map<string, number>();
  for (const c of changes) byLabel.set(`${c.label} → ${c.next ?? "none"} (was ${c.counterparty ?? "none"})`, (byLabel.get(`${c.label} → ${c.next ?? "none"} (was ${c.counterparty ?? "none"})`) ?? 0) + 1);
  for (const [k, n] of [...byLabel].sort((a, b) => b[1] - a[1]).slice(0, 40)) log(`  ${n}× ${k}`);
  if (args.dry !== undefined) return;
  // group by target value so each update is one request
  const groups = new Map<string | null, number[]>();
  for (const c of changes) groups.set(c.next, [...(groups.get(c.next) ?? []), c.id]);
  for (const [cp, ids] of groups) {
    for (let i = 0; i < ids.length; i += 200) {
      await dbGate();
      const { error } = await sb.from("xbrl_concentration").update({ counterparty: cp }).in("id", ids.slice(i, i + 200));
      if (error) throw error;
    }
  }
  log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
