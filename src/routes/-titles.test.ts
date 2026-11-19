import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The "-" prefix keeps the TanStack router generator from reading this file as a route.
// Document titles and their social copies use "Page · FiledUnder": a middle dot separator and the brand as one word.

const ROUTES = __dirname + sep;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "routeTree.gen.ts"
      ? [p]
      : [];
  });
}

/** The source of each `head:` option, found by bracket matching from the key to the comma that ends it. */
function headBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /\bhead:\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") {
        depth--;
        if (depth < 0) break;
      } else if (c === "," && depth === 0) break;
    }
    out.push(src.slice(start, i));
  }
  return out;
}

/** Title-like strings in a head block: `title`, og/twitter titles, the site name, and the title variables they reuse. */
function titleStrings(head: string): string[] {
  const patterns = [
    /\{\s*title:\s*([^\n]+)/g,
    /(?:property|name):\s*"(?:og:title|twitter:title|og:site_name)",\s*content:\s*([^\n]+)/g,
    /\bconst\s+(?:title|t)\s*=\s*([^;\n]+);/g,
  ];
  return patterns.flatMap((p) => Array.from(head.matchAll(p), (x) => x[1]));
}

describe("page titles", () => {
  const files = routeFiles(ROUTES);
  const found = files.flatMap((f) => {
    const src = readFileSync(f, "utf8");
    return headBlocks(src).flatMap((h) =>
      titleStrings(h).map((s) => ({ file: f.slice(ROUTES.length), s })),
    );
  });

  it("finds the titles it checks", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(found.length).toBeGreaterThan(100);
    expect(found.some((x) => x.file === "__root.tsx" && x.s.includes("FiledUnder"))).toBe(true);
  });

  it("use a middle dot separator and the one-word brand", () => {
    const bad = found.filter((x) => x.s.includes("—") || /Filed Under/.test(x.s));
    expect(bad).toEqual([]);
  });

  it("the helpers catch the old style", () => {
    const sample = `export const Route = createFileRoute("/x")({
  head: () => ({
    meta: [
      { title: "Screener — Filed Under" },
      { name: "description", content: "Screens — with sources" },
      {
        property: "og:title",
        content: \`\${name} — Filed Under\`,
      },
    ],
  }),
  component: X,
});`;
    const strings = headBlocks(sample).flatMap(titleStrings);
    expect(strings).toHaveLength(2);
    expect(strings.every((s) => s.includes("—"))).toBe(true);
  });
});
