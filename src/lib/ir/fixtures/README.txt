std-lines-b*.txt: IR standard-line values (revenue, operating income, net income, diluted EPS, net
interest income, provision) per ticker and period, copied from production ir_kpi_facts on
23 Nov 2026 with the checksum-verified transfer (last field = first 6 hex of md5 of the rest of the
line). b01 rows: ticker|line|end|months|
value|tables printing it|newest filing|vintages; b06+ rows: ticker|line|end|months|values (most
printed first). Used by sec-check.test.ts and twins.test.ts.

vsat-segment.folded.txt: the 26 VSAT rows of table "Revenue by segment" in documents 69085149
(supplement, printed in thousands) and bea91f83 (presentation, in dollars), copied from production
ir_kpi_facts on 24 Nov 2026 with the checksum-verified transfer (all 26 lines printed OK; checksum
column removed). Text folded: non-ASCII as "?". Fields: id|document_id|document_kind|category|metric|
breakdown|parent|label|unit|is_total|period_start|period_end|months|value|filed|method.
Used by suspect.test.ts (iracc-H5).

lkq-lines.txt: LKQ's standard-line candidates since 2025 (52 lines), the reviewer's checksum-verified
transfer of 23 Nov 2026. Fields:
ticker|category|metric|unit|is_total|label|parent|breakdown|q:yyyymmdd=v[~alt],...|y:... Real segment
lines (4% to 46% of revenue) that no scale rule may hold. Used by suspect.test.ts.

vsat-lines.txt: VSAT's standard-line candidates (same transfer and format as lkq-lines.txt). With
vsat-segment.folded.txt it rebuilds the page's VSAT payload (one document per printed cell).

hood-lines.txt: HOOD's standard-line candidates (same transfer and format as lkq-lines.txt): the
quarter 1,274,000,000 printed elsewhere as 1,274,100,000,000, the large side being the slip.
