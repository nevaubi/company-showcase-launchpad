// Company context file (description, people, photos) built by `bun scripts/company-context.ts`
// into public/data/context/TICKER.json. Pure helpers shared by the script, the app and tests.

export interface Credit {
  /** Where the file lives (Wikimedia Commons file page or company page). */
  page: string;
  author?: string;
  license?: string;
  /** "wikimedia" = free licence; "company" = company press/leadership page. */
  kind: "wikimedia" | "company";
}

export interface ContextImage {
  url: string;
  width: number;
  height: number;
  caption: string;
  credit: Credit;
}

export interface Person {
  name: string;
  title: string;
  group: "executive" | "board";
  age?: number;
  /** Year they took the current role (executives) or joined the board (directors). */
  since?: number;
  /** Year they joined the company, if stated. */
  joined?: number;
  chair?: boolean;
  independent?: boolean;
  committees?: string[];
  /** Total compensation from the proxy's Summary Compensation Table, latest year. */
  pay?: { year: number; total: number };
  bio?: string;
  /** Verbatim passage from the filing that names this person. */
  quote: string;
  source: { accn: string; doc: string; form: string; filed: string };
  photo?: { url: string; credit: Credit };
}

export interface CompanyContext {
  ticker: string;
  generatedAt: string;
  description?: { paragraphs: string[]; source: string; title: string };
  facts: {
    employees?: { value: number; asOf?: string };
    founders?: string[];
    headquarters?: string;
    wikidata?: string;
  };
  images: ContextImage[];
  people: Person[];
}

export const normalize = (s: string) =>
  s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** HTML → plain text good enough for searching filings. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

/**
 * Windows of `size` chars starting at each match of `re`, best first (most hits of `score` inside).
 * Tables of contents mention the heading too, so the densest window wins.
 */
export function bestWindows(text: string, re: RegExp, size: number, score: RegExp, take = 2): string[] {
  const out: { start: number; s: number }[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let m = g.exec(text); m; m = g.exec(text)) {
    const w = text.slice(m.index, m.index + size);
    const s = (w.match(new RegExp(score.source, "gi")) ?? []).length;
    out.push({ start: m.index, s });
  }
  out.sort((a, b) => b.s - a.s);
  const picked: number[] = [];
  for (const o of out) {
    if (o.s === 0) break;
    if (picked.some((p) => Math.abs(p - o.start) < size)) continue;
    picked.push(o.start);
    if (picked.length >= take) break;
  }
  return picked.map((p) => text.slice(p, p + size));
}

/** True when `phrase` appears in `text`, ignoring case, spacing and quote/dash styles. */
export const appearsIn = (phrase: string, text: string) => !!phrase.trim() && normalize(text).includes(normalize(phrase));

/** Name check that tolerates middle initials: first and last names must both appear near each other. */
export function nameIn(name: string, text: string): boolean {
  if (appearsIn(name, text)) return true;
  const parts = name.replace(/[.,]/g, " ").split(/\s+/).filter((p) => p.length > 1 && !/^(jr|sr|ii|iii|iv|dr|mr|ms|mrs)$/i.test(p));
  if (parts.length < 2) return false;
  const t = normalize(text);
  const first = normalize(parts[0]);
  const last = normalize(parts[parts.length - 1]);
  for (let i = t.indexOf(first); i >= 0; i = t.indexOf(first, i + 1)) {
    if (t.slice(i, i + first.length + 40).includes(last)) return true;
  }
  return false;
}

/** Number check: `n` must appear as a token, with or without thousands separators. */
export function numberIn(n: number, text: string): boolean {
  const plain = String(Math.round(n));
  const commas = Math.round(n).toLocaleString("en-US");
  const digits = text.replace(/[^\d,.\s$]/g, " ");
  const re = (s: string) => new RegExp(`(^|[^\\d,])${s.replace(/[,.]/g, "\\$&")}([^\\d,]|$)`);
  return re(plain).test(digits) || re(commas).test(digits);
}

/** Keep photo-like Commons files: no logos, maps, flags, icons, charts or signatures. */
export function usableImage(title: string, width: number, height: number): boolean {
  if (!/\.(jpe?g|png|webp)$/i.test(title)) return false;
  if (/logo|icon|map|flag|signature|chart|graph|diagram|seal|symbol|wordmark|locator|coat[_ ]of|stock[_ ]price|sales|revenue|statistic|screenshot|commons-logo|edit-clear|question/i.test(title)) return false;
  if (width < 800 || height < 450) return false;
  const r = width / height;
  return r > 0.6 && r < 2.6;
}

/** Person photo for `name` from a company leadership page's markdown, if an image sits next to the name. */
export function photoFromMarkdown(md: string, name: string, pageUrl: string): string | undefined {
  const last = name.split(/\s+/).filter((p) => p.length > 1).pop();
  if (!last) return undefined;
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.split(".").slice(-2).join(".");
    } catch {
      return "";
    }
  })();
  const re = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
  for (let m = re.exec(md); m; m = re.exec(md)) {
    const [, alt, url] = m;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(url) && !/image|photo|headshot|portrait/i.test(url)) continue;
    const near = md.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200);
    const altHit = normalize(alt).includes(normalize(last));
    const nearHit = nameIn(name, near);
    if (!altHit && !nearHit) continue;
    try {
      const abs = new URL(url, pageUrl);
      // Only images served by the company itself (or its CDN under the same registrable domain).
      if (host && !abs.hostname.endsWith(host) && !altHit) continue;
      return abs.toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Order people into a hierarchy: CEO first, then the rest of the executives; board with chair first. */
export function rankPeople(people: Person[]): { ceo?: Person; executives: Person[]; board: Person[] } {
  const isCeo = (p: Person) => /chief executive|\bceo\b/i.test(p.title);
  const execs = people.filter((p) => p.group === "executive");
  const ceo = execs.find(isCeo);
  const weight = (t: string) =>
    /president/i.test(t) && !/vice/i.test(t) ? 0 : /chief financial|\bcfo\b/i.test(t) ? 1 : /chief operating|\bcoo\b/i.test(t) ? 2 : /^chief|chief /i.test(t) ? 3 : /executive vice|evp/i.test(t) ? 4 : /senior vice|svp/i.test(t) ? 5 : 6;
  const executives = execs.filter((p) => p !== ceo).sort((a, b) => weight(a.title) - weight(b.title) || a.name.localeCompare(b.name));
  const board = people
    .filter((p) => p.group === "board")
    .sort((a, b) => Number(!!b.chair) - Number(!!a.chair) || Number(!!a.independent) - Number(!!b.independent) || a.name.localeCompare(b.name));
  return { ceo, executives, board };
}

/** Years in role as of `today` (ISO date). */
export const tenureYears = (since: number | undefined, today: string) => (since ? Math.max(0, Number(today.slice(0, 4)) - since) : undefined);
