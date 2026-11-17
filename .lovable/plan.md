# Office Studio: replace Docs & sheets

The Filed Under office engine is live but idle. This plan connects it to the app and replaces the Docs & sheets tab with four AI editors: Writer, Sheets, Slides and PDF.

## Phase 1: Foundation
- Add the editor libraries from the office suite (Tiptap/docx, Univer/xlsx, pptx, PDFium).
- Add an `office_files` table: owner, firm, kind (docx/xlsx/pptx/pdf), title, version and timestamps. Files go in a private `office-files` bucket. Access rules control who can see each file.
- Add a token issuer so the engine accepts only signed-in users with app access (signed JWT plus a JWKS endpoint).
- Add save and load routes the engine calls, with a check on every call.

## Phase 2: Editors and hub
- `/app/docs`: an Office Home hub with templates, recent files, import (drag and drop .docx/.xlsx/.pptx/.pdf) and new-file buttons.
- `/app/docs/writer/$id`, `/sheets/$id`, `/slides/$id`, `/pdf/$id`, each with a full ribbon and real file export.
- Move existing docs and sheets into the new files, then retire the old editors.

## Phase 3: AI panel for each app
- Reuse the research-agent loop (`loop.ts`). It already handles multi-step and parallel tool calls, sub-tasks, retries and context compaction.
- Editing tools for each app:
  - Sheets: read_range, set_values, set_formulas, format_range, sort, filter, freeze, merge, insert_chart, conditional_format.
  - Writer: insert_paragraph or heading, bullets, insert_table, two-column section, header/footer, page numbers, page break, apply_style, comment, track changes.
  - Slides: create_slide, layout, metric_card, chart, table, reorder, notes.
  - PDF: search, highlight_phrase, note, redact, extract_table.
- Data tools: SEC facts, IR KPIs and segments, filing grep, supply chain, alt data, prices and macro, plus web search, fetch and scrape (Tavily/Firecrawl).
- Code execution in a sandbox for models (DCF, WACC, Monte Carlo).

## Phase 4: Sourcing and teams
- Custom formulas `=FU()`, `=FU_KPI()` and `=FU_PRICE()`, plus Writer citation pills. Each figure carries its SourceRef, so clicking it opens the SEC source.
- Version history, firm workspace sharing and PDF export.

## Order of delivery
Phases ship one at a time. The old Docs tab keeps working until Phase 2 passes checks in the preview.
