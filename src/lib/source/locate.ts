// Finding a quoted line, and the printed figure inside it, in a rendered source document.
// Works on any Document (the source viewer's sandboxed iframe, or jsdom in tests).

export const normText = (s: string) =>
  s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** A row's text with its cells separated, so "Revenue" + "42" reads "revenue 42" and not "revenue42". */
export const rowText = (row: HTMLTableRowElement) =>
  normText(Array.from(row.cells, (c) => c.textContent ?? "").join(" "));

function rowWith(root: ParentNode, q: string): HTMLTableRowElement | null {
  let best: HTMLTableRowElement | null = null;
  let bestLen = Infinity;
  for (const row of Array.from(root.querySelectorAll("tr"))) {
    if (row.querySelector("tr")) continue; // a layout row that wraps another table
    const t = rowText(row);
    if (t === q) return row;
    if (t.length < bestLen && t.includes(q)) {
      best = row;
      bestLen = t.length;
    }
  }
  return best;
}

/**
 * The table row that holds a quoted line: the row that reads exactly like it, else the shortest row that
 * contains it. A quote that runs over two printed lines is found by its first words.
 */
export function quotedRow(root: ParentNode, quote: string): HTMLTableRowElement | null {
  const q = normText(quote);
  if (q.length < 4) return null;
  const whole = rowWith(root, q);
  if (whole) return whole;
  const words = q.split(" ");
  if (words.length <= 6) return null;
  const head = words.slice(0, 6).join(" ");
  return head.length >= 12 ? rowWith(root, head) : null;
}

const bare = (s: string) => s.replace(/[\s$()]/g, "");
const isFigure = (s: string) => /^[\d,.\s]+$/.test(s);

/** Marks created here carry this attribute so the viewer can unwrap them before the next search. */
export const MARK_ATTR = "data-fu-mark";

/** Removes the marks of an earlier search, leaving the text as it was. */
export function clearMarks(doc: Document) {
  for (const m of Array.from(doc.querySelectorAll(`mark[${MARK_ATTR}]`))) {
    const parent = m.parentNode;
    m.replaceWith(...Array.from(m.childNodes));
    parent?.normalize();
  }
}

/**
 * The printed figure inside a row: the cell that is exactly that figure (HTML tables, worksheets), else the
 * figure wrapped in a <mark> where it stands in the line. "692" is not found inside "1,692" or "692.5".
 */
export function markFigure(doc: Document, root: HTMLElement, token: string): HTMLElement | null {
  const want = token.trim();
  if (!want) return null;
  const figure = isFigure(want);
  if (figure) {
    for (const cell of Array.from(root.querySelectorAll<HTMLElement>("td, th"))) {
      if (!cell.querySelector("td, th") && bare(cell.textContent ?? "") === bare(want)) return cell;
    }
  }
  const low = want.toLowerCase();
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    const data = t.data.toLowerCase();
    for (let at = data.indexOf(low); at >= 0; at = data.indexOf(low, at + 1)) {
      const before = data[at - 1] ?? "";
      const after = data[at + low.length] ?? "";
      if (
        figure &&
        (/[\d,.]/.test(before) ||
          /[\d,]/.test(after) ||
          (after === "." && /\d/.test(data[at + low.length + 1] ?? "")))
      )
        continue;
      const range = doc.createRange();
      range.setStart(t, at);
      range.setEnd(t, at + low.length);
      const mark = doc.createElement("mark");
      mark.className = "fu-hl";
      mark.setAttribute(MARK_ATTR, "");
      try {
        range.surroundContents(mark);
        return mark;
      } catch {
        return null;
      }
    }
  }
  return null;
}
