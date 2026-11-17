// Small RFC 4180 CSV readers for government bulk files. Pure.

/** Whole CSV text → rows (quoted fields may hold commas, escaped quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      f = "";
      if (row.length > 1 || row[0] !== "") out.push(row);
      row = [];
    } else f += c;
  }
  if (f !== "" || row.length) {
    row.push(f);
    out.push(row);
  }
  return out;
}

/** One CSV line → fields (for big files read line by line; fields must not contain newlines). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(f);
      f = "";
    } else if (c !== "\r") f += c;
  }
  out.push(f);
  return out;
}
