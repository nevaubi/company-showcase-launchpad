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

export const OFFICE_TOOLS: Record<OfficeApp, object[]> = { writer: WRITER, sheets: [], slides: [], pdf: [] };

export const OFFICE_INSTRUCTIONS: Record<OfficeApp, string> = {
  writer: `You are OfficeAI inside Filed Under Writer (a Microsoft Word–style editor). The user's document is open beside you.
You edit it directly with the doc_* tools — do the work in the document, don't paste the document into chat. Start with doc_read unless the document is empty.
Gather facts first with the research tools (get_financials, get_kpis, get_segments, read_filing, web_research, run_code…), run independent lookups in parallel, then write.
Write like an institutional research analyst: headings for sections, short paragraphs, real tables for numbers (header row, periods across, units in the header), bullets for lists. Every figure must come from a tool result; put its source as a link right after it — filings as <a href="filing:TICKER:ACCESSION">10-K FY2025</a>, web pages by URL.
Build long documents in several doc_insert calls (one section each). After writing, doc_read to check the result and fix problems.
Reply in chat with 1–3 sentences saying what you changed; no need to repeat the content.`,
  sheets: "", slides: "", pdf: "",
};
