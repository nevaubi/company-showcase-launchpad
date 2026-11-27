// The lane board on Admin → Live worker: every background lane as running, waiting or stopped by the
// owner, what it did last, and Stop and Resume. Rules and wording: src/lib/jobs/lanes.ts.
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getLaneBoard, setLaneHold, type LaneBoard as Board } from "@/lib/jobs/lanes.functions";
import { LANE_GROUPS, type LaneView } from "@/lib/jobs/lanes";
import { cn } from "@/lib/utils";

const KEY = ["admin", "lanes"] as const;

/** "4 min ago", "3 h ago", "2 d ago". */
export function agoWords(iso: string | null | undefined, nowIso: string): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const took = (ms: number | null) => (ms == null ? null : ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null);

const STATE_LABEL: Record<LaneView["state"], string> = { running: "Running", waiting: "Waiting", held: "Stopped by owner" };
const STATE_TONE: Record<LaneView["state"], string> = { running: "text-positive", waiting: "text-muted-foreground", held: "text-warning" };

/** What the State cell says under the badge. */
function stateNote(l: LaneView, now: string): string | null {
  if (l.state === "running") return l.runningSince ? `since ${agoWords(l.runningSince, now)}` : null;
  if (l.state === "waiting") return l.late ? "no run for longer than its rhythm" : null;
  const h = l.hold!;
  if (h.ranSince) return "The running worker recorded a run after this stop: it does not check holds for this lane yet (it will after the next worker deploy).";
  if (h.unseen) return "The worker has not seen this stop yet. It looks once a minute; if this stays, the running worker predates the lane board.";
  if (h.seenAt) return `seen by the worker ${agoWords(h.seenAt, now)}`;
  return l.holdOn ? null : "the worker sees it within a minute";
}

export function LaneBoard() {
  const read = useServerFn(getLaneBoard);
  const write = useServerFn(setLaneHold);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => read(), refetchInterval: 30_000 });
  const [stop, setStop] = useState<LaneView | null>(null);
  const [why, setWhy] = useState("");
  const m = useMutation({
    mutationFn: (v: { lane: string; action: "hold" | "release"; why?: string }) => write({ data: v }),
    onSuccess: (board: Board, v) => {
      qc.setQueryData(KEY, board);
      const label = board.lanes.find((l) => l.id === v.lane)?.label ?? v.lane;
      toast.success(v.action === "hold" ? `${label} stopped. The worker sees it within a minute.` : `${label} resumed. It takes its work again on its next look.`);
      setStop(null);
      setWhy("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't change the lane"),
  });

  const lanes = q.data?.lanes;
  const counts = useMemo(() => {
    const c = { running: 0, waiting: 0, held: 0, late: 0 };
    for (const l of lanes ?? []) {
      c[l.state]++;
      if (l.late) c.late++;
    }
    return c;
  }, [lanes]);

  return (
    <Panel
      title="Lanes"
      subtitle={
        lanes
          ? `${counts.running} running · ${counts.waiting} waiting · ${counts.held} stopped${counts.late ? ` · ${counts.late} late` : ""} · read ${agoWords(q.data!.at, new Date().toISOString())}`
          : "Every background lane of the worker"
      }
      collapse={false}
      bodyClassName="p-0"
      className="min-w-0"
    >
      <div data-section="Lanes">
        {q.isError ? (
          <p className="px-3.5 py-4 text-sm text-muted-foreground">The lanes could not be read: {(q.error as Error).message}</p>
        ) : !lanes ? (
          <div className="p-3.5">
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="border-b text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3.5 py-2 font-normal">Lane</th>
                  <th className="w-[220px] px-3.5 py-2 font-normal">State</th>
                  <th className="w-[230px] px-3.5 py-2 font-normal">Last run</th>
                  <th className="w-[84px] px-3.5 py-2 text-right font-normal">Runs, 24 h</th>
                  <th className="w-[92px] px-3.5 py-2 text-right font-normal">
                    <span className="sr-only">Stop or resume</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {LANE_GROUPS.map((g) => {
                  const rows = lanes.filter((l) => l.group === g);
                  if (!rows.length) return null;
                  return (
                    <Fragment key={g}>
                      <tr className="border-b bg-muted/40">
                        <th colSpan={5} scope="colgroup" className="px-3.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground">
                          {g}
                        </th>
                      </tr>
                      {rows.map((l) => {
                        const note = stateNote(l, q.data!.at);
                        const warn = l.state === "held" && (l.hold!.ranSince || l.hold!.unseen);
                        return (
                          <tr key={l.id} className="border-b align-top last:border-b-0" data-lane={l.id}>
                            <td className="px-3.5 py-2">
                              <div className="font-medium">{l.label}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {l.what} Runs {l.every}.{l.spends ? ` Spends ${l.spends}.` : ""}
                              </div>
                            </td>
                            <td className="px-3.5 py-2">
                              <Badge variant="outline" className={cn("whitespace-nowrap", l.late ? "text-negative" : STATE_TONE[l.state])}>
                                {l.late ? "Late" : STATE_LABEL[l.state]}
                              </Badge>
                              {l.state === "held" ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {l.hold!.why}
                                  {l.hold!.since ? ` · since ${day(l.hold!.since)}` : ""}
                                </div>
                              ) : null}
                              {note ? <div className={cn("mt-1 text-xs", warn ? "text-negative" : "text-muted-foreground")}>{note}</div> : null}
                            </td>
                            <td className="px-3.5 py-2">
                              {l.last ? (
                                <>
                                  <div className="num">
                                    {agoWords(l.last.at, q.data!.at)}
                                    {l.last.ok === false ? <span className="text-negative"> · failed</span> : null}
                                    {took(l.last.ms) ? <span className="text-muted-foreground"> · took {took(l.last.ms)}</span> : null}
                                  </div>
                                  {l.last.note ? <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={l.last.note}>{l.last.note}</div> : null}
                                </>
                              ) : (
                                <span className="text-muted-foreground">No run recorded</span>
                              )}
                            </td>
                            <td className="num px-3.5 py-2 text-right">
                              {l.runs24h.toLocaleString("en-US")}
                              {l.failed24h ? <div className="text-xs text-negative">{l.failed24h.toLocaleString("en-US")} failed</div> : null}
                            </td>
                            <td className="px-3.5 py-2 text-right">
                              {l.state === "held" ? (
                                <Button size="xs" variant="outline" disabled={m.isPending} onClick={() => m.mutate({ lane: l.id, action: "release" })} aria-label={`Resume ${l.label}`}>
                                  Resume
                                </Button>
                              ) : (
                                <Button size="xs" variant="ghost" disabled={m.isPending} onClick={() => { setWhy(""); setStop(l); }} aria-label={`Stop ${l.label}`}>
                                  Stop
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!stop} onOpenChange={(o) => { if (!o) setStop(null); }}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (stop && why.trim().length >= 3) m.mutate({ lane: stop.id, action: "hold", why: why.trim() });
            }}
          >
            <DialogHeader>
              <DialogTitle>Stop {stop?.label}?</DialogTitle>
              <DialogDescription>
                {stop?.what} It starts nothing more, a run in progress is stopped, and it stays stopped until you resume it. What it has stored stays, and it picks up where it stopped.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-1.5">
              <Label htmlFor="lane-stop-why">Why it is stopped</Label>
              <Input id="lane-stop-why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} placeholder="Shown on this page and on Freshness" autoFocus />
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setStop(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={m.isPending || why.trim().length < 3}>
                {m.isPending ? "Stopping…" : "Stop lane"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
