// SEC filing HTML → prose blocks and Item sections. Pure (regex tokenizer, no DOM) so the same code
// runs in the browser worker, the precompute script and tests.

export interface Block {
  text: string;
  /** Mostly bold/italic short block: a risk-factor or note heading. */
  heading: boolean;
}

export interface Section {
  key: string;
  title: string;
  blocks: Block[];
}

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", bull: "•", middot: "·", hellip: "…", reg: "®", trade: "™", copy: "©", sect: "§", para: "¶",
  ensp: " ", emsp: " ", thinsp: " ", zwsp: "", shy: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code)) return m;
      if (code === 160 || code === 8194 || code === 8195 || code === 8201) return " ";
      if (code === 8203 || code === 173) return "";
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const BLOCK = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "ul", "ol", "center", "blockquote", "section", "article", "body", "html"]);
const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "col", "area", "base", "wbr"]);
const EMPH_TAG = new Set(["b", "strong", "i", "em", "u"]);

function emphasized(tag: string, attrs: string): boolean {
  if (EMPH_TAG.has(tag)) return true;
  const m = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  const st = m ? m[1] ?? m[2] ?? "" : "";
  return /font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(st) || /font-style\s*:\s*italic/i.test(st) || /text-decoration\s*:\s*underline/i.test(st);
}

/**
 * Prose blocks in reading order. Tables with real data are dropped (their numbers change every period
 * and are covered by the XBRL statements); small layout tables (≤ 3 rows, short) are read as text,
 * because some filers put "Item 1A. | Risk Factors" in a two-cell table.
 */
export function htmlToBlocks(html: string): Block[] {
  const src = html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, " ");
  const out: Block[] = [];
  let runs: { t: string; e: boolean }[] = [];
  const stack: { tag: string; e: boolean }[] = [];
  let emph = 0;
  let tableDepth = 0;
  let tableRows = 0;
  let tableText: string[] = [];
  let rowText: string[] = [];

  const flush = () => {
    if (!runs.length) return;
    const raw = runs.map((r) => r.t).join("");
    const text = raw.replace(/\s+/g, " ").trim();
    if (text) {
      const total = runs.reduce((n, r) => n + r.t.replace(/\s/g, "").length, 0) || 1;
      const em = runs.reduce((n, r) => n + (r.e ? r.t.replace(/\s/g, "").length : 0), 0);
      out.push({ text, heading: em / total >= 0.8 && text.length <= 600 });
    }
    runs = [];
  };

  const re = /<(\/?)([a-zA-Z][\w:.-]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, close, tagRaw, attrs, textRaw] = m;
    if (textRaw != null) {
      const t = decodeEntities(textRaw);
      if (!t.trim() && !runs.length) continue;
      if (tableDepth > 0) rowText.push(t);
      else runs.push({ t, e: emph > 0 });
      continue;
    }
    const tag = tagRaw.toLowerCase().replace(/^.*:/, (p) => (p === "ix:" ? "" : p));
    if (tag === "table") {
      if (!close) {
        if (tableDepth === 0) { flush(); tableRows = 0; tableText = []; rowText = []; }
        tableDepth++;
      } else if (tableDepth > 0) {
        tableDepth--;
        if (tableDepth === 0) {
          if (rowText.length) { tableText.push(rowText.join(" ")); rowText = []; tableRows++; }
          const txt = tableText.join(" ").replace(/\s+/g, " ").trim();
          // Layout table: few rows, little text, mostly words.
          const digits = (txt.match(/\d/g) ?? []).length;
          if (txt && tableRows <= 3 && txt.length <= 400 && digits / txt.length < 0.15) out.push({ text: txt, heading: /^item\s/i.test(txt) || txt.length < 160 });
        }
      }
      continue;
    }
    if (tableDepth > 0) {
      if (tag === "tr" && close) { tableText.push(rowText.join(" ")); rowText = []; tableRows++; }
      else if ((tag === "td" || tag === "th") && close) rowText.push(" ");
      continue;
    }
    if (VOID.has(tag)) { if (tag === "br" || tag === "hr") flush(); continue; }
    if (attrs.trim().endsWith("/")) continue;
    if (!close) {
      const e = emphasized(tag, attrs);
      if (BLOCK.has(tag)) flush();
      stack.push({ tag, e });
      if (e) emph++;
    } else {
      // Pop to the matching tag (tolerates unclosed inner tags).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          for (let j = stack.length - 1; j >= i; j--) if (stack[j].e) emph--;
          stack.length = i;
          break;
        }
      }
      if (BLOCK.has(tag)) flush();
    }
  }
  flush();
  return dropArtifacts(out);
}

/** Page numbers, running headers/footers, "Table of Contents" back-links; re-join paragraphs split by a page break. */
function dropArtifacts(blocks: Block[]): Block[] {
  const counts = new Map<string, number>();
  for (const b of blocks) if (b.text.length < 120) counts.set(b.text.toLowerCase(), (counts.get(b.text.toLowerCase()) ?? 0) + 1);
  const kept = blocks.filter((b) => {
    const t = b.text;
    if (/^(page\s*)?[\divxlc\-–\s]{1,8}$/i.test(t)) return false;
    if (/^(table of contents|index|back to (top|contents))$/i.test(t)) return false;
    if (t.length < 120 && (counts.get(t.toLowerCase()) ?? 0) >= 6) return false;
    return true;
  });
  const out: Block[] = [];
  for (const b of kept) {
    const prev = out[out.length - 1];
    if (prev && !prev.heading && !b.heading && /^[a-z]/.test(b.text) && !/[.!?:;”")]$/.test(prev.text)) prev.text = `${prev.text} ${b.text}`;
    else out.push({ ...b });
  }
  return out;
}

/** Sections compared in each form, keyed by part + item. */
export const SECTION_DEFS: Record<"10-K" | "10-Q", { key: string; title: string; weight: number }[]> = {
  "10-K": [
    { key: "1", title: "Business", weight: 0.7 },
    { key: "1A", title: "Risk factors", weight: 1.2 },
    { key: "1C", title: "Cybersecurity", weight: 1.1 },
    { key: "3", title: "Legal proceedings", weight: 1.3 },
    { key: "7", title: "MD&A", weight: 1 },
    { key: "7A", title: "Market risk", weight: 0.9 },
    { key: "8", title: "Financial statements & notes", weight: 0.9 },
    { key: "9A", title: "Controls & procedures", weight: 1.4 },
    { key: "9B", title: "Other information", weight: 1.1 },
  ],
  "10-Q": [
    { key: "I-1", title: "Financial statements & notes", weight: 0.9 },
    { key: "I-2", title: "MD&A", weight: 1 },
    { key: "I-3", title: "Market risk", weight: 0.9 },
    { key: "I-4", title: "Controls & procedures", weight: 1.4 },
    { key: "II-1", title: "Legal proceedings", weight: 1.3 },
    { key: "II-1A", title: "Risk factors", weight: 1.2 },
    { key: "II-5", title: "Other information", weight: 1.1 },
  ],
};

const ITEM_RE = /^\s*item\s*(\d{1,2}\s?[a-c]?)\s*(?:[.:\-–—]|\s)\s*(.{0,160})$/i;
const PART_RE = /^\s*part\s+(i{1,2}|1|2)\b(?!\w)/i;

/**
 * Split blocks into Item sections. A filing names every Item twice (table of contents, then the
 * section itself); for each Item the occurrence followed by the most text is the real one.
 */
export function splitSections(blocks: Block[], form: "10-K" | "10-Q"): Section[] {
  const defs = SECTION_DEFS[form];
  const hits: { idx: number; key: string }[] = [];
  let part = "I";
  for (let i = 0; i < blocks.length; i++) {
    const t = blocks[i].text;
    if (t.length > 220) continue;
    const p = PART_RE.exec(t);
    if (p) { part = /^(ii|2)$/i.test(p[1]) ? "II" : "I"; }
    const m = ITEM_RE.exec(p ? t.replace(PART_RE, "").replace(/^[\s.,:\-–—]+/, "") : t);
    if (!m) continue;
    const item = m[1].replace(/\s/g, "").toUpperCase();
    hits.push({ idx: i, key: form === "10-Q" ? `${part}-${item}` : item });
  }
  // Text length following each hit until the next hit.
  const len = (k: number) => {
    const end = k + 1 < hits.length ? hits[k + 1].idx : blocks.length;
    let n = 0;
    for (let i = hits[k].idx + 1; i < end; i++) n += blocks[i].text.length;
    return n;
  };
  const best = new Map<string, { idx: number; n: number }>();
  hits.forEach((h, k) => {
    const n = len(k);
    const cur = best.get(h.key);
    if (!cur || n > cur.n) best.set(h.key, { idx: h.idx, n });
  });
  const chosen = [...best.entries()].map(([key, v]) => ({ key, idx: v.idx })).sort((a, b) => a.idx - b.idx);
  const out: Section[] = [];
  // 10-K notes often sit after Item 15 rather than under Item 8.
  const notesRe = /^notes to (the )?(condensed )?consolidated financial statements\b/i;
  const item8 = chosen.find((c) => c.key === "8");
  let notes: { idx: number; end: number; n: number } | null = null;
  if (form === "10-K") {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].text.length > 160 || !notesRe.test(blocks[i].text)) continue;
      let end = blocks.length, n = 0;
      for (let j = i + 1; j < blocks.length; j++) {
        if (/^(signatures|exhibit index)$/i.test(blocks[j].text) || (blocks[j].text.length < 160 && ITEM_RE.test(blocks[j].text) && /^\s*item\s*1[56]/i.test(blocks[j].text))) { end = j; break; }
        n += blocks[j].text.length;
      }
      if (!notes || n > notes.n) notes = { idx: i, end, n };
    }
  }
  chosen.forEach((c, k) => {
    const def = defs.find((d) => d.key === c.key);
    if (!def) return;
    const end = k + 1 < chosen.length ? chosen[k + 1].idx : blocks.length;
    const body = blocks.slice(c.idx + 1, end).filter((b) => !/^part\s+i{1,2}\b/i.test(b.text) || b.text.length > 80);
    if (c.key === "8" && body.length < 20) return; // statements/notes sit elsewhere (filled below)
    if (body.length) out.push({ key: def.key, title: def.title, blocks: body });
  });
  if (form === "10-K" && !out.some((s) => s.key === "8")) {
    const def = defs.find((d) => d.key === "8")!;
    if (notes) out.push({ key: def.key, title: def.title, blocks: blocks.slice(notes.idx + 1, notes.end) });
    else {
      // Statements and notes filed under Item 15 ("Exhibits and Financial Statement Schedules").
      const k15 = chosen.findIndex((c) => c.key === "15");
      if (k15 >= 0) {
        const end = k15 + 1 < chosen.length ? chosen[k15 + 1].idx : blocks.length;
        const body = blocks.slice(chosen[k15].idx + 1, end).filter((b) => !/^signatures$/i.test(b.text));
        if (body.length >= 20) out.push({ key: def.key, title: def.title, blocks: body });
      }
    }
  }
  out.sort((a, b) => defs.findIndex((d) => d.key === a.key) - defs.findIndex((d) => d.key === b.key));
  return out;
}
