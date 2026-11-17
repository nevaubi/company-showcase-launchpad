// Office Studio editor tools for the shared research agent (pure definitions,
// used by the server step and the browser executors).
export type OfficeApp = "writer" | "sheets" | "slides" | "pdf";

const n = (t: object) => ({ anyOf: [t, { type: "null" }] });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const fn = (name: string, description: string, props: Record<string, object>) => ({
  type: "function", name, description, strict: true,
  parameters: { type: "object", properties: props, required: Object.keys(props), additionalProperties: false },
});

const WRITER = [
  fn("doc_read", "Read the open Word document as numbered top-level blocks ([index] type: text). Always call before editing an existing document, and again after large edits.", {}),
  fn("doc_insert", "Insert rich content (HTML) into the document. Allowed tags: h1-h4, p, ul, ol, li, table/thead/tbody/tr/th/td, strong, em, u, s, mark, a, br, hr (hr = page break). Use real tables for figures.", {
    html: str("HTML fragment"),
    position: { type: "string", enum: ["end", "start", "before", "after", "cursor"] },
    index: n(int("Block index for before/after; null otherwise")),
  }),
  fn("doc_replace_blocks", "Replace blocks from..to (inclusive) with new HTML (rewrite a section, fix a table).", { from: int("first block"), to: int("last block"), html: str("replacement HTML") }),
  fn("doc_delete_blocks", "Delete blocks from..to inclusive.", { from: int("first block"), to: int("last block") }),
  fn("doc_find_replace", "Find text and replace it everywhere (or first match).", { find: str("exact text"), replace: str("replacement"), all: { type: "boolean" } }),
  fn("doc_format_blocks", "Restyle blocks from..to: paragraph style, alignment, and/or toggle marks across their text.", {
    from: int("first block"), to: int("last block"),
    style: n({ type: "string", enum: ["paragraph", "h1", "h2", "h3", "h4", "bullet_list", "numbered_list"] }),
    align: n({ type: "string", enum: ["left", "center", "right", "justify"] }),
    marks: n({ type: "array", items: { type: "string", enum: ["bold", "italic", "underline", "strike", "highlight"] } }),
  }),
  fn("doc_page_setup", "Set header text, footer text, page numbers and one/two-column layout. null leaves a setting unchanged.", {
    header: n(str("header text")), footer: n(str("footer text")), page_numbers: n({ type: "boolean" }), columns: n({ type: "integer", enum: [1, 2] }),
  }),
  fn("doc_set_title", "Rename the document.", { title: str("new title") }),
];

const RANGE = str("A1 range, e.g. A1:D12, B:B or 3:3");
const SHEET = n(str("sheet name; null = active sheet"));
const SHEETS = [
  fn("sheet_read", "Read the workbook: sheet list, used range, and cells as raw input (formulas) plus computed values. Call before editing and after writing formulas to check results.", { sheet: SHEET, range: n(RANGE) }),
  fn("sheet_write", "Write a 2-D block of values starting at a cell. Strings starting with '=' are formulas (SUM, AVERAGE, MIN, MAX, COUNT, IF, ROUND, ABS…, plus FU(\"TICKER\",\"metric\",\"FY2025\") for Filed Under SEC data and PRICE(\"TICKER\")). Use null to clear a cell.", {
    sheet: SHEET, start: str("top-left cell, e.g. A1"),
    values: { type: "array", items: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] } } },
  }),
  fn("sheet_format", "Format a range: number format, bold/italic/underline, fill and text colour (hex like #1F4E79), alignment, borders. null leaves a setting unchanged.", {
    sheet: SHEET, range: RANGE,
    number_format: n({ type: "string", enum: ["general", "number", "usd", "usdM", "pct", "x"] }),
    bold: n({ type: "boolean" }), italic: n({ type: "boolean" }), underline: n({ type: "boolean" }),
    fill: n(str("hex colour or '' to clear")), color: n(str("hex colour or '' to clear")),
    align: n({ type: "string", enum: ["left", "center", "right"] }), border: n({ type: "boolean" }),
  }),
  fn("sheet_sort", "Sort the rows of a range by one column.", { sheet: SHEET, range: RANGE, by_column: str("column letter inside the range"), descending: { type: "boolean" }, has_header: { type: "boolean" } }),
  fn("sheet_fill", "Copy the first row (down) or first column (right) of a range across it, shifting relative references — like dragging the fill handle.", { sheet: SHEET, range: RANGE, direction: { type: "string", enum: ["down", "right"] } }),
  fn("sheet_clear", "Clear a range's contents, formats or both.", { sheet: SHEET, range: RANGE, what: { type: "string", enum: ["all", "contents", "formats"] } }),
  fn("sheet_rows", "Insert (count>0) or delete (count<0) whole rows at a 1-based row number.", { sheet: SHEET, row: int("1-based row"), count: int("rows to insert (+) or delete (-)") }),
  fn("sheet_layout", "Set column widths (pixels) for columns, and/or freeze header rows/columns. null leaves unchanged.", {
    sheet: SHEET, columns: n(str("column span, e.g. A:C")), width: n(int("pixels, 40-400")), freeze_rows: n(int("rows to freeze")), freeze_cols: n(int("columns to freeze")),
  }),
  fn("sheet_chart", "Add a chart drawn from the sheet. labels = category range (one column), series = value ranges (one column each, first cell may be the series name if include_names).", {
    sheet: SHEET, type: { type: "string", enum: ["bar", "line", "area", "pie"] }, title: str("chart title"),
    labels: RANGE, series: { type: "array", items: { type: "string" } }, anchor: str("cell where the chart's top-left sits, e.g. F2"),
  }),
  fn("sheet_delete_chart", "Remove a chart by id (ids are listed by sheet_read).", { sheet: SHEET, id: str("chart id") }),
  fn("sheet_manage", "Add, rename, delete or switch to a worksheet tab.", { action: { type: "string", enum: ["add", "rename", "delete", "activate"] }, name: str("sheet name"), new_name: n(str("for rename")) }),
  fn("sheet_set_title", "Rename the workbook file.", { title: str("new title") }),
];

const num = (d: string) => ({ type: "number", description: d });
const EL_PROPS = {
  text: n(str("text for text/shape elements (\\n for new lines)")),
  bullets: n({ type: "array", items: { type: "string" }, description: "bullet lines" }),
  rows: n({ type: "array", items: { type: "array", items: { type: "string" } }, description: "table rows; first row is the header" }),
  chart: n({ type: "object", additionalProperties: false, required: ["type", "labels", "series"], properties: {
    type: { type: "string", enum: ["bar", "line", "area", "pie"] }, labels: { type: "array", items: { type: "string" } },
    series: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "values"], properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } } } },
  } }),
  metric: n({ type: "object", additionalProperties: false, required: ["value", "label", "delta"], properties: { value: { type: "string" }, label: { type: "string" }, delta: n({ type: "string" }) } }),
  shape: n({ type: "string", enum: ["rect", "rounded", "ellipse", "line"] }),
  style: n({ type: "object", additionalProperties: false, required: ["size", "bold", "italic", "color", "fill", "align", "valign"], properties: {
    size: n(num("font pt")), bold: n({ type: "boolean" }), italic: n({ type: "boolean" }), color: n(str("hex")), fill: n(str("hex")),
    align: n({ type: "string", enum: ["left", "center", "right"] }), valign: n({ type: "string", enum: ["top", "middle", "bottom"] }),
  } }),
};
const SLIDES = [
  fn("deck_read", "Read the deck: theme and every slide's elements with ids, boxes (inches on a 13.33×7.5 slide) and content. Call before editing.", {}),
  fn("slide_add", "Add a slide from a layout (title, title_content = title + bullets, two_content, section, title_only, blank). Returns its number and element ids.", {
    layout: { type: "string", enum: ["title", "title_content", "two_content", "section", "title_only", "blank"] },
    position: n(int("1-based position; null = end")), title: str("title text"), subtitle: n(str("subtitle, or first bullet for title_content")),
  }),
  fn("slide_manage", "Delete, duplicate or move a slide, set its background, or set its speaker notes.", {
    slide: int("1-based slide"), action: { type: "string", enum: ["delete", "duplicate", "move", "background", "notes"] },
    to: n(int("target position for move")), value: n(str("hex colour for background, text for notes")),
  }),
  fn("element_add", "Add an element to a slide: text, bullets, table, chart (native, editable in PowerPoint), metric (big-number KPI card), or shape. Position in inches; keep 0.5in margins and avoid overlaps.", {
    slide: int("1-based slide"), type: { type: "string", enum: ["text", "bullets", "table", "chart", "metric", "shape"] },
    x: num("left in"), y: num("top in"), w: num("width in"), h: num("height in"), ...EL_PROPS,
  }),
  fn("element_update", "Change an element's content, box or style. null leaves a field unchanged.", {
    slide: int("1-based slide"), id: str("element id"), x: n(num("in")), y: n(num("in")), w: n(num("in")), h: n(num("in")), ...EL_PROPS,
  }),
  fn("element_delete", "Delete an element.", { slide: int("1-based slide"), id: str("element id") }),
  fn("deck_theme", "Set the deck theme. null leaves unchanged.", { accent: n(str("hex accent colour")), font: n({ type: "string", enum: ["Aptos", "Calibri", "Georgia", "Arial"] }), dark: n({ type: "boolean" }) }),
  fn("deck_set_title", "Rename the deck file.", { title: str("new title") }),
];

const PAGE = int("1-based page number");
const PDF = [
  fn("pdf_read", "Read the PDF: page count and sizes (points, 612×792 = Letter), each page's text, and every annotation with its id. Long documents: pass a page range.", {
    pages: n(str("page range like 1-5 or 3; null = all (text truncated)")),
  }),
  fn("pdf_search", "Search the PDF text; returns every page and snippet where the phrase occurs.", { query: str("phrase to find") }),
  fn("pdf_mark_text", "Highlight, underline, strike through or redact every occurrence of an exact phrase (optionally on one page), with an optional margin note next to the first hit. Use this to mark evidence in filings.", {
    phrase: str("exact text as it appears in the PDF"), page: n(PAGE), style: { type: "string", enum: ["highlight", "underline", "strike", "redact"] },
    color: n(str("hex colour")), note: n(str("margin note text placed beside the first occurrence")), first_only: n({ type: "boolean" }),
  }),
  fn("pdf_annotate", "Place an annotation by position: note (sticky note box), text (free text), rect (outline box), redact (black box), stamp (e.g. APPROVED, CONFIDENTIAL), highlight. x/y are points from the page's top-left.", {
    page: PAGE, type: { type: "string", enum: ["note", "text", "rect", "redact", "stamp", "highlight"] },
    x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, text: n(str("text for note/text/stamp")), color: n(str("hex colour")),
  }),
  fn("pdf_annotation_update", "Change or delete an annotation by id.", {
    id: str("annotation id"), delete: n({ type: "boolean" }), text: n(str("")), color: n(str("hex")),
    x: n({ type: "number" }), y: n({ type: "number" }), w: n({ type: "number" }), h: n({ type: "number" }),
  }),
  fn("pdf_add_page", "Insert a new Letter page with text: a title plus a body where lines starting '# ' are headings, '## ' subheadings, '- ' bullets, blank lines separate paragraphs. About 450 words fit on a page — split longer content over several pages.", {
    position: n(int("1-based position for the new page; null = end")), title: str("page title"), body: str("page body"),
  }),
  fn("pdf_page_update", "Rewrite a page you created with pdf_add_page.", { page: PAGE, title: n(str("")), body: n(str("")) }),
  fn("pdf_pages", "Delete, move or duplicate a page.", { page: PAGE, action: { type: "string", enum: ["delete", "move", "duplicate"] }, to: n(int("target position for move")) }),
  fn("pdf_set_title", "Rename the PDF file.", { title: str("new title") }),
];

export const OFFICE_TOOLS: Record<OfficeApp, object[]> = { writer: WRITER, sheets: SHEETS, slides: SLIDES, pdf: PDF };

export const OFFICE_INSTRUCTIONS: Record<OfficeApp, string> = {
  writer: `You are OfficeAI inside Filed Under Writer (a Microsoft Word–style editor). The user's document is open beside you.
You edit it directly with the doc_* tools — do the work in the document, don't paste the document into chat. Start with doc_read unless the document is empty.
Gather facts first with the research tools (get_financials, get_kpis, get_segments, read_filing, web_research, run_code…), run independent lookups in parallel, then write.
Write like an institutional research analyst: headings for sections, short paragraphs, real tables for numbers (header row, periods across, units in the header), bullets for lists. Every figure must come from a tool result; put its source as a link right after it — filings as <a href="filing:TICKER:ACCESSION">10-K FY2025</a>, web pages by URL.
Build long documents in several doc_insert calls (one section each). After writing, doc_read to check the result and fix problems.
Reply in chat with 1–3 sentences saying what you changed; no need to repeat the content.`,
  sheets: `You are OfficeAI inside Filed Under Sheets (a Microsoft Excel–style workbook). The user's workbook is open beside you.
Build and edit it directly with the sheet_* tools — never paste tables into chat. Start with sheet_read unless the workbook is empty.
Gather data first with the research tools (get_financials, get_kpis, get_segments, get_prices, run_code…) in parallel. Prefer live formulas: FU("NVDA","revenue","FY2025") pulls SEC-sourced values that stay clickable to their filing; use plain numbers only for data FU cannot provide, and put the source (filing link or URL) in a "Source" column or note row.
Model like an analyst: a bold title row, header row with fill and border, periods across columns, line items down, units in labels, number formats (usdM for $ millions, pct for margins/growth, x for multiples), derived rows as formulas (growth =C3/B3-1, margins =C4/C3), freeze the header, sensible column widths, totals with SUM. Add a chart when it helps.
Write blocks with one sheet_write per table, then format, then sheet_read to check computed values (fix any #N/A, #REF!, #VALUE!).
Reply in chat with 1–3 sentences on what you built or changed.`,
  slides: `You are OfficeAI inside Filed Under Slides (a Microsoft PowerPoint–style editor). The user's deck is open beside you.
Build and edit it directly with the slide_*/element_* tools — never paste slides into chat. Start with deck_read.
Gather facts first with the research tools (get_financials, get_kpis, get_segments, read_filing, web_research…) in parallel, then build slides.
Design like an investment-bank pitch deck: one message per slide stated in the title (an "action title"), at most 5 short bullets, big-number metric cards for headline KPIs, native charts for trends, compact tables for comparisons, consistent margins (0.6in sides, content from y=1.5), no overlapping boxes, nothing outside 13.33×7.5in. Use the title layout for the cover and section layout between parts.
Every number must come from a tool result; put sources in a small text element at the bottom of the slide (y≈6.9, size 9) or in the speaker notes — filings as filing:TICKER:ACCESSION links, web pages by URL.
After building, deck_read to check layout and fix overlaps. Reply in chat with 1–3 sentences on what you built.`,
  pdf: `You are OfficeAI inside Filed Under PDF Studio (an Adobe Acrobat–style PDF editor). The user's PDF is open beside you.
Work directly in the PDF with the pdf_* tools — never paste the PDF into chat. Start with pdf_read (a page range for long files) or pdf_search to find passages.
Review like a diligence analyst: mark evidence with pdf_mark_text using the exact wording from pdf_read/pdf_search (highlight for key facts, underline for risks, redact for sensitive data), add short margin notes that say why a passage matters, and stamp pages when asked. Cross-check figures in the PDF against Filed Under data (get_financials, get_kpis, get_segments, read_filing) and note any mismatch with both values and the filing source.
To write new content (summaries, cover pages, memos) use pdf_add_page with headings and bullets; every number must come from a tool result with its source (filing TICKER ACCESSION or URL) written next to it.
After editing, pdf_read the touched pages to check. Reply in chat with 1–3 sentences on what you marked or added.`,
};
