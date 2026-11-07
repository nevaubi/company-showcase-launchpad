// Cleans the assistant's prose before it is shown: removes tool-call echoes and stack traces, turns
// leaked JSON into something readable (a Markdown table, a chart block, or a canvas view) and hides
// everything else behind a collapsed "data" disclosure. Code stays only when the user asked for code.
import { parseViewSpec, type ViewSpec } from "@/lib/research/view-spec";

export interface Sanitized {
  markdown: string;
  /** Valid view specs found in the prose, to add to the canvas. */
  views: ViewSpec[];
  /** How many blobs were hidden or converted. */
  changed: number;
}

const CODE_LANGS = new Set(["js", "javascript", "ts", "typescript", "tsx", "jsx", "python", "py", "sql", "bash", "sh", "shell", "r", "go", "rust", "java", "c", "cpp", "csharp", "cs", "ruby", "php", "swift", "kotlin", "excel", "vba", "html", "css", "yaml", "yml", "toml", "xml", "graphql"]);
const TOOL_NAMES = /\b(render_view|create_file|browser_(task|status|files|stop)|scroll_to|highlight|read_section|show_canvas|update_plan|ask_user|run_code|get_[a-z_]+|web_[a-z_]+|read_[a-z_]+|navigate_to|screen_companies|fetch_url|simulate_supply_shock)\b/;

/** Did the user ask to see code (so code blocks stay)? */
export function wantsCode(question: string) {
  return /\b(code|script|snippet|function|query|sql|python|javascript|typescript|regex|formula|json|api call|curl|implement|program)\b/i.test(question);
}

function relaxedParse(src: string): unknown {
  const t = src.trim();
  if (!/^[[{]/.test(t)) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    try {
      // Trailing commas and single-quoted keys/strings are common in leaked specs.
      return JSON.parse(t.replace(/,\s*([}\]])/g, "$1").replace(/'([^'\\]*)'/g, '"$1"'));
    } catch {
      return undefined;
    }
  }
}

type Scalar = string | number | boolean | null;
const isScalar = (v: unknown): v is Scalar => v == null || ["string", "number", "boolean"].includes(typeof v);

function esc(v: Scalar) {
  if (v == null) return "—";
  if (typeof v === "number") return Math.abs(v) >= 1e4 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(+v.toFixed(4));
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function mdTable(columns: string[], rows: Scalar[][]) {
  return [`| ${columns.map((c) => esc(c)).join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
}

/** Array of flat records with shared keys → columns/rows. */
function asRecords(v: unknown): { columns: string[]; rows: Scalar[][] } | null {
  if (!Array.isArray(v) || !v.length || v.length > 200) return null;
  if (!v.every((r) => r && typeof r === "object" && !Array.isArray(r) && Object.values(r as object).every(isScalar))) return null;
  const columns = [...new Set(v.flatMap((r) => Object.keys(r as object)))];
  if (!columns.length || columns.length > 12) return null;
  const shared = columns.filter((c) => v.filter((r) => c in (r as object)).length >= v.length * 0.6);
  if (shared.length < Math.min(2, columns.length)) return null;
  return { columns: shared, rows: v.map((r) => shared.map((c) => ((r as Record<string, Scalar>)[c] ?? null) as Scalar)) };
}

/** {label: number, ...} → two-column rows. */
function asKeyed(v: unknown): { columns: string[]; rows: Scalar[][] } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const e = Object.entries(v as object);
  if (e.length < 2 || e.length > 60 || !e.every(([, x]) => typeof x === "number")) return null;
  return { columns: ["Item", "Value"], rows: e.map(([k, x]) => [k, x as number]) };
}

function isToolEcho(v: unknown) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : typeof o.tool === "string" ? o.tool : typeof o.function === "string" ? o.function : "";
  if (name && ("arguments" in o || "parameters" in o || "args" in o || "input" in o)) return true;
  if (o.type === "function_call" || o.type === "function_call_output" || o.type === "tool_use") return true;
  return "call_id" in o || "tool_calls" in o;
}

/** Decide what a leaked JSON value becomes. */
export function convertJson(v: unknown): { md: string; view?: ViewSpec; kind: "view" | "table" | "chart" | "drop" | "data" } {
  if (isToolEcho(v)) return { md: "", kind: "drop" };
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { type?: unknown }).type === "string") {
    const r = parseViewSpec(v);
    if (r.ok) return { md: `_Shown in the canvas: ${r.spec.title ?? r.spec.type}._`, view: r.spec, kind: "view" };
    // A view spec the model pasted instead of rendering, but invalid: hide it.
    if ("data" in (v as object) || "series" in (v as object) || "items" in (v as object)) return { md: dataBlock(v), kind: "data" };
  }
  const rec = asRecords(v);
  if (rec) {
    const [x, ...rest] = rec.columns;
    const numericCols = rest.filter((c) => rec.rows.every((r) => typeof r[rec.columns.indexOf(c)] === "number" || r[rec.columns.indexOf(c)] == null));
    const xIsLabel = rec.rows.every((r) => typeof r[0] === "string");
    if (rec.rows.length >= 4 && xIsLabel && numericCols.length >= 1 && numericCols.length === rest.length && numericCols.length <= 5) {
      const spec = { type: /^(19|20)\d\d|^(fy|q[1-4])/i.test(String(rec.rows[0][0])) ? "line" : "bar", x, series: numericCols, data: rec.rows.map((r) => Object.fromEntries(rec.columns.map((c, i) => [c, r[i]]))) };
      return { md: "```chart\n" + JSON.stringify(spec) + "\n```", kind: "chart" };
    }
    return { md: mdTable(rec.columns, rec.rows), kind: "table" };
  }
  const keyed = asKeyed(v);
  if (keyed) return { md: mdTable(keyed.columns, keyed.rows), kind: "table" };
  return { md: dataBlock(v), kind: "data" };
}

const dataBlock = (v: unknown) => "```data\n" + JSON.stringify(v, null, 2).slice(0, 8000) + "\n```";

const TRACE_LINE = /^\s*at\s+(?:async\s+)?[\w$.<>[\]\s/-]*\(?[^()\s]*:\d+:\d+\)?\s*$/;
const ERROR_HEAD = /^\s*(?:Uncaught\s+)?(?:[A-Z]\w*)?(?:Error|Exception)(?:\s*\[\w+\])?:\s.*$/;

function stripTraces(lines: string[]) {
  const out: string[] = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*Traceback \(most recent call last\):\s*$/.test(l)) {
      let j = i + 1;
      while (j < lines.length && (/^\s+/.test(lines[j]) || /^\s*File "/.test(lines[j]))) j++;
      if (j < lines.length && /^\w+(\.\w+)*(Error|Exception|Interrupt)\b/.test(lines[j])) j++;
      i = j - 1;
      removed++;
      continue;
    }
    if (ERROR_HEAD.test(l) && i + 1 < lines.length && TRACE_LINE.test(lines[i + 1])) {
      let j = i + 1;
      while (j < lines.length && TRACE_LINE.test(lines[j])) j++;
      i = j - 1;
      removed++;
      continue;
    }
    if (TRACE_LINE.test(l) && (TRACE_LINE.test(lines[i + 1] ?? "") || TRACE_LINE.test(lines[i - 1] ?? ""))) {
      removed++;
      continue;
    }
    out.push(l);
  }
  return { lines: out, removed };
}

/** Index just past the JSON value starting at s[i] (bracket matching that respects strings), or -1. */
function jsonEnd(s: string, i: number) {
  const open = s[i];
  if (open !== "{" && open !== "[") return -1;
  let depth = 0, inStr = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

export function sanitizeAnswer(markdown: string, opts: { allowCode?: boolean } = {}): Sanitized {
  if (!markdown) return { markdown, views: [], changed: 0 };
  const views: ViewSpec[] = [];
  let changed = 0;
  let s = markdown;

  // 1. Tool-call markup.
  s = s.replace(/<(tool_call|function_calls?|invoke|tool_use|antml:[\w]+)\b[\s\S]*?<\/\1>/gi, () => (changed++, ""));
  s = s.replace(/^[ \t]*(?:to=)?functions\.[a-z_]+.*$/gim, () => (changed++, ""));
  s = s.replace(/^[ \t]*(?:Calling|Called|Tool call:?|I(?:'ll| will) call)\s+`?[a-z_]+`?\s*\(.*\)\s*\.?\s*$/gim, (m) => (TOOL_NAMES.test(m) ? (changed++, "") : m));
  s = s.replace(/^[ \t]*`?([a-z_]+)\((\{[\s\S]*?\})\)`?\s*$/gm, (m, name: string) => (TOOL_NAMES.test(name) ? (changed++, "") : m));

  // 2. Fenced blocks.
  s = s.replace(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g, (m, langRaw: string, body: string) => {
    const lang = langRaw.toLowerCase();
    if (lang === "chart" || lang === "data") return m;
    const value = relaxedParse(body);
    if (value !== undefined && (lang === "" || lang === "json" || lang === "jsonc" || lang === "javascript" || lang === "js" || lang === "text")) {
      if (opts.allowCode && lang !== "") return m;
      const c = convertJson(value);
      changed++;
      if (c.view) views.push(c.view);
      return c.md;
    }
    if (CODE_LANGS.has(lang) || (lang === "" && /[;{}]\s*$|^\s*(def|function|const|let|import|SELECT|for|if)\b/m.test(body))) {
      if (opts.allowCode) return m;
      changed++;
      return "```hidden-code\n" + body + "```";
    }
    return m;
  });

  // 3. Bare JSON blobs and stack traces outside fences.
  const parts = s.split(/(```[\s\S]*?```)/g);
  for (let p = 0; p < parts.length; p += 2) {
    let text = parts[p];
    let out = "";
    let i = 0;
    while (i < text.length) {
      const atLine = i === 0 || text[i - 1] === "\n";
      const ch = text[i];
      if (atLine && (ch === "{" || ch === "[")) {
        const end = jsonEnd(text, i);
        if (end > 0 && end - i >= 30) {
          const value = relaxedParse(text.slice(i, end));
          if (value !== undefined && typeof value === "object") {
            const c = convertJson(value);
            changed++;
            if (c.view) views.push(c.view);
            out += c.md;
            i = end;
            continue;
          }
        }
      }
      out += ch;
      i++;
    }
    text = out;
    const tr = stripTraces(text.split("\n"));
    changed += tr.removed;
    parts[p] = tr.lines.join("\n");
  }
  s = parts.join("");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return { markdown: s, views, changed };
}
