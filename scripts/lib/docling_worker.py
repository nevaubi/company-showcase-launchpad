"""
Docling worker for scripts/ir-docling.ts. Reads JSON lines {"src": pdf, "out": json} on stdin,
converts each PDF once (layout + TableFormer ACCURATE, plus Tesseract OCR when the job says the
PDF has pages without a text layer) and writes the document's reading-order items as JSON. Models load once per worker, so many
workers run in parallel, each on a few CPU threads.
"""
import json, os, sys, time, traceback

threads = int(os.environ.get("DOCLING_THREADS", "4"))
max_pages = int(os.environ.get("DOCLING_MAX_PAGES", "90"))

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode, TesseractCliOcrOptions
try:
    from docling.datamodel.accelerator_options import AcceleratorOptions
except ImportError:  # older layout
    from docling.datamodel.pipeline_options import AcceleratorOptions

def make_converter(ocr):
    opts = PdfPipelineOptions()
    # OCR only for documents with pages that lack a text layer: on text PDFs it changed no table
    # cell in testing and more than doubled conversion time. TableFormer stays ACCURATE unless
    # DOCLING_TABLES=fast (5x faster, ~99% of cells in a Capital One test).
    opts.do_ocr = ocr
    if ocr:
        opts.ocr_options = TesseractCliOcrOptions(lang=["eng"])
    opts.do_table_structure = True
    opts.table_structure_options.mode = TableFormerMode.FAST if os.environ.get("DOCLING_TABLES") == "fast" else TableFormerMode.ACCURATE
    opts.table_structure_options.do_cell_matching = True
    opts.accelerator_options = AcceleratorOptions(num_threads=threads, device="cpu")
    opts.generate_page_images = False
    opts.generate_picture_images = False
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})


converters = {}


def converter_for(ocr):
    if ocr not in converters:
        converters[ocr] = make_converter(ocr)
    return converters[ocr]


def page_of(item):
    return item.prov[0].page_no if getattr(item, "prov", None) else None


def table_rows(item):
    rows = []
    for r, row in enumerate(item.data.grid):
        cells = []
        for c, cell in enumerate(row):
            origin = cell.start_row_offset_idx == r and cell.start_col_offset_idx == c
            cells.append({"t": (cell.text or "").strip(), "h": bool(cell.column_header), "o": bool(origin)})
        rows.append(cells)
    return rows


def convert(src, ocr=True):
    res = converter_for(ocr).convert(src, max_num_pages=max_pages, raises_on_error=True)
    doc = res.document
    items = []
    for item, _level in doc.iterate_items():
        kind = type(item).__name__
        page = page_of(item)
        if kind == "TableItem":
            rows = table_rows(item)
            if rows:
                items.append({"type": "table", "page": page, "rows": rows})
        elif hasattr(item, "text") and item.text and item.text.strip():
            label = str(getattr(item, "label", "text")).split(".")[-1].lower()
            if label in ("page_header", "page_footer"):
                continue
            items.append({"type": "text", "page": page, "label": label, "text": item.text.strip()})
    return {"pages": len(doc.pages), "items": items}


converter_for(False)  # load the text-PDF models before reporting ready
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    job = json.loads(line)
    t0 = time.time()
    try:
        out = convert(job["src"], bool(job.get("ocr", True)))
        with open(job["out"], "w") as f:
            json.dump(out, f)
        print(json.dumps({"ok": True, "out": job["out"], "seconds": round(time.time() - t0, 1), "pages": out["pages"], "tables": sum(1 for i in out["items"] if i["type"] == "table")}), flush=True)
    except Exception as e:  # report and keep serving
        print(json.dumps({"ok": False, "out": job["out"], "error": f"{type(e).__name__}: {str(e)[:300]}", "trace": traceback.format_exc()[-600:]}), flush=True)
