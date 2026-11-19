export const OWNER_IMPORT_ORDER = ['SPCX', 'ZM', 'OWL', 'EFC', 'WDC', 'CME', 'EVER', 'SOFI'];
export function parseOwnerCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (quoted) throw new Error('Unclosed manifest CSV field');
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  if (!header?.includes('sha256') || !header.includes('file')) throw new Error('Invalid owner manifest headers');
  return body.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ''])));
}