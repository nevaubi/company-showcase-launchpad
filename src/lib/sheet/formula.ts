// A small spreadsheet formula engine: arithmetic, comparisons, ranges, common
// functions, and FU()/PRICE() for pulling Filed Under data into cells.

export class FormulaError {
  constructor(public code: string, public detail?: string) {}
  toString() {
    return this.code;
  }
}
export type Scalar = number | string | boolean | FormulaError | null;
type Value = Scalar | Scalar[];

export interface SheetContext {
  get: (ref: string) => string | undefined;
  fu?: (ticker: string, metric: string, period: string) => number | FormulaError;
  price?: (symbol: string) => number | FormulaError;
}

export const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
export const colIndex = (s: string) => s.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export function parseRef(ref: string): { c: number; r: number } | null {
  const m = ref.replace(/\$/g, "").toUpperCase().match(/^([A-Z]{1,3})(\d{1,5})$/);
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
}
export const refOf = (c: number, r: number) => `${colName(c)}${r + 1}`;

// ---------- tokenizer ----------
type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "(" | ")" | "," | ":" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
      if (!m) throw new FormulaError("#VALUE!", "bad number");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== '"') s += src[j++];
      if (j >= src.length) throw new FormulaError("#VALUE!", "unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const word = src.slice(i).match(/^\$?[A-Za-z_][A-Za-z0-9_.]*\$?\d*/);
    if (word) {
      const w = word[0];
      if (/^\$?[A-Za-z]{1,3}\$?\d{1,5}$/.test(w)) out.push({ t: "ref", v: w.replace(/\$/g, "").toUpperCase() });
      else out.push({ t: "name", v: w.toUpperCase() });
      i += w.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if ("(),:".includes(ch)) {
      out.push({ t: ch as "(" });
      i++;
      continue;
    }
    throw new FormulaError("#NAME?", `unexpected "${ch}"`);
  }
  return out;
}

// ---------- parser / evaluator ----------
type Node =
  | { k: "lit"; v: Scalar }
  | { k: "ref"; ref: string }
  | { k: "range"; a: string; b: string }
  | { k: "un"; op: string; x: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "pct"; x: Node }
  | { k: "fn"; name: string; args: Node[] };

function parse(tokens: Tok[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t?: string) => {
    const tok = tokens[p++];
    if (t && (!tok || (tok.t !== t && !(tok.t === "op" && tok.v === t)))) throw new FormulaError("#VALUE!", `expected ${t}`);
    return tok;
  };
  const isOp = (v: string[]) => peek()?.t === "op" && v.includes((peek() as { v: string }).v);

  function comparison(): Node {
    let a = additive();
    while (isOp(["=", "<>", "<", ">", "<=", ">="])) {
      const op = (eat() as { v: string }).v;
      a = { k: "bin", op, a, b: additive() };
    }
    return a;
  }
  function additive(): Node {
    let a = term();
    while (isOp(["+", "-", "&"])) {
      const op = (eat() as { v: string }).v;
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  }
  function term(): Node {
    let a = power();
    while (isOp(["*", "/"])) {
      const op = (eat() as { v: string }).v;
      a = { k: "bin", op, a, b: power() };
    }
    return a;
  }
  function power(): Node {
    let a = unary();
    while (isOp(["^"])) {
      eat();
      a = { k: "bin", op: "^", a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    if (isOp(["-", "+"])) {
      const op = (eat() as { v: string }).v;
      return { k: "un", op, x: unary() };
    }
    let x = primary();
    while (isOp(["%"])) {
      eat();
      x = { k: "pct", x };
    }
    return x;
  }
  function primary(): Node {
    const tok = eat();
    if (!tok) throw new FormulaError("#VALUE!", "unexpected end");
    if (tok.t === "num") return { k: "lit", v: tok.v };
    if (tok.t === "str") return { k: "lit", v: tok.v };
    if (tok.t === "ref") {
      if (peek()?.t === ":") {
        eat();
        const b = eat("ref") as { v: string };
        return { k: "range", a: tok.v, b: b.v };
      }
      return { k: "ref", ref: tok.v };
    }
    if (tok.t === "name") {
      if (tok.v === "TRUE" || tok.v === "FALSE") return { k: "lit", v: tok.v === "TRUE" };
      if (peek()?.t !== "(") throw new FormulaError("#NAME?", tok.v);
      eat("(");
      const args: Node[] = [];
      if (peek()?.t !== ")") {
        args.push(comparison());
        while (peek()?.t === ",") {
          eat();
          args.push(comparison());
        }
      }
      eat(")");
      return { k: "fn", name: tok.v, args };
    }
    if (tok.t === "(") {
      const e = comparison();
      eat(")");
      return e;
    }
    throw new FormulaError("#VALUE!", "unexpected token");
  }
  const n = comparison();
  if (p < tokens.length) throw new FormulaError("#VALUE!", "trailing input");
  return n;
}

const isErr = (v: unknown): v is FormulaError => v instanceof FormulaError;
const num = (v: Scalar): number | FormulaError => {
  if (isErr(v)) return v;
  if (v == null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[,$\s]/g, "").replace(/%$/, ""));
  if (!Number.isFinite(n)) return new FormulaError("#VALUE!", `"${v}" is not a number`);
  return String(v).trim().endsWith("%") ? n / 100 : n;
};
const flat = (vals: Value[]): Scalar[] => vals.flatMap((v) => (Array.isArray(v) ? v : [v]));
const nums = (vals: Value[]) => {
  const out: number[] = [];
  for (const v of flat(vals)) {
    if (isErr(v)) return v;
    if (typeof v === "number") out.push(v);
    else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[,$]/g, "")))) out.push(Number(v.replace(/[,$]/g, "")));
  }
  return out;
};

export class Sheet {
  private cache = new Map<string, Scalar>();
  private stack = new Set<string>();
  constructor(private ctx: SheetContext) {}

  invalidate() {
    this.cache.clear();
  }

  value(ref: string): Scalar {
    const key = ref.toUpperCase();
    if (this.cache.has(key)) return this.cache.get(key)!;
    if (this.stack.has(key)) return new FormulaError("#CYCLE!", `circular reference at ${key}`);
    const raw = this.ctx.get(key);
    let out: Scalar;
    if (raw == null || raw === "") out = null;
    else if (raw.startsWith("=")) {
      this.stack.add(key);
      try {
        const v = this.evalNode(parse(tokenize(raw.slice(1))));
        out = Array.isArray(v) ? (v[0] ?? null) : v;
      } catch (e) {
        out = isErr(e) ? e : new FormulaError("#VALUE!", (e as Error).message);
      } finally {
        this.stack.delete(key);
      }
    } else {
      const n = Number(raw.replace(/,/g, ""));
      out = raw.trim() !== "" && Number.isFinite(n) ? n : /^-?\d+(\.\d+)?%$/.test(raw.trim()) ? Number(raw.trim().slice(0, -1)) / 100 : raw;
    }
    this.cache.set(key, out);
    return out;
  }

  private range(a: string, b: string): Scalar[] {
    const pa = parseRef(a);
    const pb = parseRef(b);
    if (!pa || !pb) return [new FormulaError("#REF!")];
    const out: Scalar[] = [];
    for (let r = Math.min(pa.r, pb.r); r <= Math.max(pa.r, pb.r); r++)
      for (let c = Math.min(pa.c, pb.c); c <= Math.max(pa.c, pb.c); c++) out.push(this.value(refOf(c, r)));
    return out;
  }

  private evalNode(n: Node): Value {
    switch (n.k) {
      case "lit":
        return n.v;
      case "ref":
        return parseRef(n.ref) ? this.value(n.ref) : new FormulaError("#REF!");
      case "range":
        return this.range(n.a, n.b);
      case "pct": {
        const x = num(this.scalar(n.x));
        return isErr(x) ? x : x / 100;
      }
      case "un": {
        const x = num(this.scalar(n.x));
        return isErr(x) ? x : n.op === "-" ? -x : x;
      }
      case "bin": {
        const a = this.scalar(n.a);
        const b = this.scalar(n.b);
        if (n.op === "&") return isErr(a) ? a : isErr(b) ? b : `${a ?? ""}${b ?? ""}`;
        if (["=", "<>", "<", ">", "<=", ">="].includes(n.op)) {
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          const x = typeof a === "number" && typeof b === "number" ? a : String(a ?? "");
          const y = typeof a === "number" && typeof b === "number" ? b : String(b ?? "");
          return { "=": x === y, "<>": x !== y, "<": x < y, ">": x > y, "<=": x <= y, ">=": x >= y }[n.op]!;
        }
        const x = num(a);
        const y = num(b);
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        if (n.op === "+") return x + y;
        if (n.op === "-") return x - y;
        if (n.op === "*") return x * y;
        if (n.op === "/") return y === 0 ? new FormulaError("#DIV/0!") : x / y;
        if (n.op === "^") return x ** y;
        return new FormulaError("#VALUE!");
      }
      case "fn":
        return this.call(n.name, n.args);
    }
  }

  private scalar(n: Node): Scalar {
    const v = this.evalNode(n);
    return Array.isArray(v) ? (v.length === 1 ? v[0] : new FormulaError("#VALUE!", "range used as a value")) : v;
  }

  private call(name: string, args: Node[]): Value {
    const vals = () => args.map((a) => this.evalNode(a));
    const agg = (f: (xs: number[]) => number | FormulaError) => {
      const xs = nums(vals());
      return isErr(xs) ? xs : f(xs);
    };
    switch (name) {
      case "SUM":
        return agg((xs) => xs.reduce((a, b) => a + b, 0));
      case "AVERAGE":
      case "AVG":
        return agg((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : new FormulaError("#DIV/0!")));
      case "MIN":
        return agg((xs) => (xs.length ? Math.min(...xs) : 0));
      case "MAX":
        return agg((xs) => (xs.length ? Math.max(...xs) : 0));
      case "MEDIAN":
        return agg((xs) => {
          if (!xs.length) return new FormulaError("#N/A");
          const s = [...xs].sort((a, b) => a - b);
          const m = s.length >> 1;
          return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        });
      case "PRODUCT":
        return agg((xs) => xs.reduce((a, b) => a * b, 1));
      case "COUNT":
        return agg((xs) => xs.length);
      case "COUNTA":
        return flat(vals()).filter((v) => v != null && v !== "").length;
      case "ABS": {
        const x = num(this.scalar(args[0]));
        return isErr(x) ? x : Math.abs(x);
      }
      case "ROUND": {
        const x = num(this.scalar(args[0]));
        const d = args[1] ? num(this.scalar(args[1])) : 0;
        if (isErr(x)) return x;
        if (isErr(d)) return d;
        const f = 10 ** d;
        return Math.round(x * f) / f;
      }
      case "IF": {
        const c = this.scalar(args[0]);
        if (isErr(c)) return c;
        return c ? (args[1] ? this.scalar(args[1]) : true) : args[2] ? this.scalar(args[2]) : false;
      }
      case "IFERROR": {
        const v = this.scalar(args[0]);
        return isErr(v) ? this.scalar(args[1]) : v;
      }
      case "AND":
        return flat(vals()).every((v) => !!v && !isErr(v));
      case "OR":
        return flat(vals()).some((v) => !!v && !isErr(v));
      case "NOT":
        return !this.scalar(args[0]);
      case "GROWTH": {
        const a = num(this.scalar(args[0]));
        const b = num(this.scalar(args[1]));
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        return b === 0 ? new FormulaError("#DIV/0!") : a / b - 1;
      }
      case "CAGR": {
        const a = num(this.scalar(args[0]));
        const b = num(this.scalar(args[1]));
        const y = num(this.scalar(args[2]));
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        if (isErr(y)) return y;
        return a <= 0 || y <= 0 ? new FormulaError("#NUM!") : (b / a) ** (1 / y) - 1;
      }
      case "FU": {
        if (!this.ctx.fu) return new FormulaError("#NAME?");
        const [t, m, p, s] = args.map((a) => this.scalar(a));
        if ([t, m].some(isErr)) return (isErr(t) ? t : m) as FormulaError;
        const v = this.ctx.fu(String(t ?? ""), String(m ?? ""), p == null || isErr(p) ? "latest" : String(p));
        if (isErr(v)) return v;
        const scale = String(s ?? "").toUpperCase();
        return scale === "M" ? v / 1e6 : scale === "B" ? v / 1e9 : scale === "K" ? v / 1e3 : v;
      }
      case "PRICE": {
        if (!this.ctx.price) return new FormulaError("#NAME?");
        return this.ctx.price(String(this.scalar(args[0]) ?? ""));
      }
      default:
        return new FormulaError("#NAME?", `unknown function ${name}`);
    }
  }
}

/** Tickers referenced by FU()/PRICE() so the editor can prefetch their data. */
export function referencedSymbols(cells: Record<string, string>) {
  const fu = new Set<string>();
  const px = new Set<string>();
  for (const raw of Object.values(cells)) {
    if (!raw?.startsWith("=")) continue;
    for (const m of raw.matchAll(/FU\(\s*"([A-Za-z.]+)"/gi)) fu.add(m[1].toUpperCase());
    for (const m of raw.matchAll(/PRICE\(\s*"([A-Za-z.^]+)"/gi)) px.add(m[1].toUpperCase());
  }
  return { fu: [...fu], price: [...px] };
}

export type CellFormat = "general" | "number" | "usd" | "usdM" | "pct" | "x";

export function formatValue(v: Scalar, fmt: CellFormat = "general"): string {
  if (v == null) return "";
  if (v instanceof FormulaError) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "#NUM!";
  switch (fmt) {
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "usd":
      return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(v) < 1000 ? 2 : 0 });
    case "usdM":
      return `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
    case "x":
      return `${v.toFixed(1)}×`;
    case "number":
      return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    default:
      return Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(Number(v.toPrecision(10)));
  }
}
