import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { getWorkerProgress, type WorkerProgress } from "@/lib/worker.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/worker")({
  head: () => ({
    meta: [
      { title: "Admin · Live worker — Filed Under" },
      { name: "description", content: "Live progress of the always-on investor-relations build worker." },
      { property: "og:title", content: "Admin · Live worker — Filed Under" },
      { property: "og:description", content: "Live progress of the always-on investor-relations build worker." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkerPage,
});

const n = (v: number) => v.toLocaleString("en-US");
const ago = (iso: string | null | undefined, now: string) => {
  if (!iso) return "never";
  const s = Math.round((Date.parse(now) - Date.parse(iso)) / 1000);
  if (s < 0) return `in ${Math.round(-s / 60)} min`;
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${(s / 3600).toFixed(1)} h ago`;
};

function derive(p: WorkerProgress) {
  const docs = p.docs ?? {};
  const facts = p.facts ?? {};
  const withFiles = Object.keys(docs).filter((t) => docs[t][0] > 0);
  const withFacts = withFiles.filter((t) => (facts[t] ?? 0) > 0);
  const totalFacts = Object.values(facts).reduce((a, b) => a + b, 0);
  const recentFacts = Object.values(p.recent ?? {}).reduce((a, b) => a + b, 0);
  const stored = withFiles.reduce((a, t) => a + docs[t][0], 0);
  const read = withFiles.reduce((a, t) => a + docs[t][1], 0);
  const loop = p.loop;
  const done = new Set(loop?.done ?? []);
  const current = new Set(loop?.current ?? []);
  const finished = withFacts.filter((t) => done.has(t)).length;
  const zeroDone = [...done].filter((t) => !(facts[t] > 0) && docs[t]?.[0] > 0);
  const queue = (p.universe.length ? p.universe : withFiles).filter(
    (t) => docs[t]?.[0] > 0 && !(facts[t] > 0) && !current.has(t) && !done.has(t),
  );
  const leaseOk = !!p.lease?.lease_until && Date.parse(p.lease.lease_until) > Date.parse(p.now);
  const beat = loop?.heartbeat ? (Date.parse(p.now) - Date.parse(loop.heartbeat)) / 60000 : Infinity;
  const status = !leaseOk ? "stopped" : beat > 30 ? "stalled" : "running";
  return { withFiles, withFacts, totalFacts, recentFacts, stored, read, finished, zeroDone, queue, status };
}

function WorkerPage() {
  const fetchFn = useServerFn(getWorkerProgress);
  const q = useQuery({ queryKey: ["admin", "worker"], queryFn: () => fetchFn(), refetchInterval: 20_000 });
  const d = useMemo(() => (q.data ? derive(q.data) : null), [q.data]);
  if (q.isError) return <p className="p-6 text-sm text-muted-foreground">Couldn't load worker progress: {(q.error as Error).message}</p>;
  if (!q.data || !d) return <p className="p-6 text-sm text-muted-foreground">Loading live progress…</p>;
  const p = q.data;
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4">
      <PageHeader title="Live worker" description="The always-on cloud worker reading every investor-relations file. Refreshes every 20 seconds from the database." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {[
          ["Worker", d.status, `heartbeat ${ago(p.loop?.heartbeat, p.now)}`],
          ["Companies with figures", `${n(d.withFacts.length)} / ${n(d.withFiles.length)}`, pct(d.withFacts.length, d.withFiles.length)],
          ["Figures (live count)", n(d.totalFacts), `+${n(d.recentFacts)} last hour`],
          ["Files read", `${n(d.read)} / ${n(d.stored)}`, pct(d.read, d.stored)],
          ["Waiting in queue", n(d.queue.length), "stored files, no figures yet"],
          ["Done but empty", n(d.zeroDone.length), "re-queued once automatically"],
          ["Office engine", p.engine?.ok ? "online" : "offline", p.engine ? `${n(p.engine.sessions)} open documents · v${p.engine.version}` : "health check failed"],
        ].map(([k, v, s]) => (
          <div key={k} className="min-w-0 rounded-md border border-border p-3">
            <p className="text-[11px] text-muted-foreground">{k}</p>
            <p className={cn("num mt-0.5 text-lg font-medium", k === "Office engine" ? (p.engine?.ok ? "text-positive" : "text-warning") : k === "Worker" && (d.status === "running" ? "text-positive" : "text-warning"))}>{v}</p>
            <p className="text-[10px] text-muted-foreground">{s}</p>
          </div>
        ))}
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary" style={{ width: pct(d.withFacts.length, d.withFiles.length) }} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={`Reading now${p.loop?.cycle ? ` · cycle ${p.loop.cycle}` : ""}`} className="min-w-0">
          <p className="mb-2 text-[11px] text-muted-foreground">Started {ago(p.loop?.cycleStartedAt, p.now)} · mirror {ago(p.loop?.lastMirror, p.now)}</p>
          {(p.loop?.current ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Between batches.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase text-muted-foreground"><tr><th className="text-left">Company</th><th className="text-right">Files read</th><th className="text-right">Figures</th><th className="text-right">Last hour</th><th className="text-right">Tries</th></tr></thead>
              <tbody>
                {p.loop!.current.map((t) => (
                  <tr key={t} className="border-t border-border/60">
                    <td className="py-1"><Link to="/app/companies/$ticker/ir" params={{ ticker: t }} className="font-medium hover:underline">{t}</Link></td>
                    <td className="num text-right">{n(p.docs[t]?.[1] ?? 0)} / {n(p.docs[t]?.[0] ?? 0)}</td>
                    <td className="num text-right">{n(p.facts[t] ?? 0)}</td>
                    <td className="num text-right">{p.recent[t] ? `+${n(p.recent[t])}` : "—"}</td>
                    <td className="num text-right">{p.loop!.resumes[t] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Worker log" className="min-w-0">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-snug text-muted-foreground">
            {(p.loop?.log ?? []).slice().reverse().join("\n") || "No log lines yet — they appear once the updated worker finishes its next step."}
          </pre>
        </Panel>
      </div>
      <Panel title={`Up next (${n(d.queue.length)})`} className="min-w-0">
        <p className="flex flex-wrap gap-1.5 text-[12px]">
          {d.queue.slice(0, 60).map((t, i) => (
            <span key={t} className="rounded border border-border px-1.5 py-0.5"><span className="text-muted-foreground">{i + 1}.</span> {t}</span>
          ))}
        </p>
      </Panel>
      {d.zeroDone.length > 0 && (
        <Panel title={`Marked done with no figures (${d.zeroDone.length})`} className="min-w-0">
          <p className="text-[12px] text-muted-foreground">{d.zeroDone.join(", ")}</p>
        </Panel>
      )}
    </div>
  );
}
