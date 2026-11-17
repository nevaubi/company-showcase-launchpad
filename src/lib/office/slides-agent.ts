// Browser executor for the Slides tools (agent-tools.ts) against the live deck.
import type { ToolRun } from "@/lib/research/execute";
import { clampEl, describeSlide, duplicateSlide, makeSlide, moveSlide, uid, type Deck, type El, type ElStyle, type Layout } from "@/lib/office/deck";

export interface SlidesHost { deck: () => Deck; commit: () => void; setTitle: (t: string) => void; select: (i: number) => void }

const strip = <T extends object>(o: T | null | undefined) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Partial<T> : undefined);

function content(a: Record<string, unknown>): Partial<El> {
  const o: Partial<El> = {};
  if (a.text != null) o.text = String(a.text);
  if (a.bullets != null) o.bullets = a.bullets as string[];
  if (a.rows != null) o.rows = a.rows as string[][];
  if (a.chart != null) o.chart = a.chart as El["chart"];
  if (a.metric != null) { const m = a.metric as { value: string; label: string; delta: string | null }; o.metric = { value: m.value, label: m.label, delta: m.delta ?? undefined }; }
  if (a.shape != null) o.shape = a.shape as El["shape"];
  return o;
}

export function slidesTool(h: SlidesHost) {
  return (name: string, a: Record<string, unknown>): Promise<ToolRun> | null => {
    if (!/^(deck_|slide_|element_)/.test(name)) return null;
    const d = h.deck();
    const ok = (summary: string, output = summary) => { h.commit(); return Promise.resolve({ summary, output }); };
    const slideAt = (n: unknown) => { const i = Number(n) - 1; const s = d.slides[i]; if (!s) throw new Error(`No slide ${n} — deck has ${d.slides.length}`); return { s, i }; };
    switch (name) {
      case "deck_read":
        return ok(`Read ${d.slides.length} slides`, `Theme ${JSON.stringify(d.theme)}; slide 13.33×7.5in\n${d.slides.map(describeSlide).join("\n")}`.slice(0, 24000));
      case "slide_add": {
        const s = makeSlide(a.layout as Layout, String(a.title ?? ""), (a.subtitle as string) ?? "");
        const pos = a.position ? Math.max(0, Math.min(d.slides.length, Number(a.position) - 1)) : d.slides.length;
        d.slides.splice(pos, 0, s); h.select(pos);
        return ok(`Added slide ${pos + 1} (${a.layout})`, describeSlide(s, pos));
      }
      case "slide_manage": {
        const { s, i } = slideAt(a.slide);
        if (a.action === "delete") { if (d.slides.length === 1) throw new Error("A deck needs one slide"); d.slides.splice(i, 1); h.select(Math.max(0, i - 1)); return ok(`Deleted slide ${i + 1}`); }
        if (a.action === "duplicate") { const j = duplicateSlide(d, i); h.select(j); return ok(`Duplicated slide ${i + 1} → ${j + 1}`); }
        if (a.action === "move") { moveSlide(d, i, Number(a.to) - 1); return ok(`Moved slide ${i + 1} to ${a.to}`); }
        if (a.action === "background") { s.bg = (a.value as string) || undefined; return ok(`Set slide ${i + 1} background`); }
        s.notes = String(a.value ?? ""); return ok(`Set notes on slide ${i + 1}`);
      }
      case "element_add": {
        const { s, i } = slideAt(a.slide);
        const e = clampEl({ id: uid(), type: a.type as El["type"], x: Number(a.x), y: Number(a.y), w: Number(a.w), h: Number(a.h), ...content(a), style: strip(a.style as ElStyle | null) });
        s.els.push(e); h.select(i);
        return ok(`Added ${e.type} to slide ${i + 1}`, `Element ${e.id} added`);
      }
      case "element_update": {
        const { s, i } = slideAt(a.slide);
        const k = s.els.findIndex((e) => e.id === a.id);
        if (k < 0) throw new Error(`No element ${a.id} on slide ${i + 1}`);
        const box = strip({ x: a.x, y: a.y, w: a.w, h: a.h } as Record<string, number | null>);
        s.els[k] = clampEl({ ...s.els[k], ...box, ...content(a), style: { ...s.els[k].style, ...strip(a.style as ElStyle | null) } });
        h.select(i);
        return ok(`Updated ${a.id} on slide ${i + 1}`);
      }
      case "element_delete": { const { s, i } = slideAt(a.slide); s.els = s.els.filter((e) => e.id !== a.id); return ok(`Deleted ${a.id} from slide ${i + 1}`); }
      case "deck_theme": Object.assign(d.theme, strip({ accent: a.accent, font: a.font, dark: a.dark } as Record<string, unknown>)); return ok("Updated theme");
      case "deck_set_title": h.setTitle(String(a.title)); return ok(`Renamed deck to ${a.title}`);
    }
    return null;
  };
}
