# Try faster, cheaper readers on HOOD's hardest files

## Options worth testing
**Open-source converters (layout/tables, no AI cost per page):**
- **Docling** (IBM): strong table structure, PDF/XLSX/PPTX, outputs table grids. Already used for partner tables.
- **Marker / MinerU**: fast PDF-to-structured conversion with table detection; MinerU is very good on dense financial tables.
- **PaddleOCR PP-Structure / olmOCR**: best for scanned or image-only pages.

**Vision models run in parallel:**
- **Gemini 3 Flash through the built-in AI gateway**: cheap and fast, needs no extra account, and doesn't depend on the Claude credit that ran out.
- **Open models (Qwen-VL family)**: lowest cost per page, but need a hosted GPU server.

Converters only make the page copy cleaner. A model still has to decide what each figure *is*. So the real gains are (a) fewer rejected or missed figures and (b) cheaper slide reading.

## Plan
1. Pick 20 hard HOOD files: big monthly Excel sheets, dense supplements, the 11 unread presentations, and a few scanned pages.
2. Run each candidate through the existing comparison test against the current output: Docling, MinerU, Gemini 3 Flash slides, and Sonnet as the baseline. The test reports figures found, figures matching the source, cost and time.
3. Show you a short scorecard. Switch only where a candidate is as accurate and cheaper or faster.
4. If Gemini wins on slides, use it to read HOOD's 11 remaining presentations now and rebuild.
5. Docling and MinerU run in the background scripts here first. A hosted server (for example on Render) only if they win.

## Technical notes
- Add `--reader=docling|mineru` to `scripts/ir-renditions.ts` (keeps the `{t,r,c}` cell locator format), and a `gemini-*` model route in `src/lib/openai.server.ts` for the vision runner.
- Compare with `scripts/ir-vision-pilot.ts --same=<report.json>`, per the IR rules; there are no production switches without the scorecard.
