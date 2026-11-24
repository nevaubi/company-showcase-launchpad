std-lines-b*.txt: IR standard-line values (revenue, operating income, net income, diluted EPS, net
interest income, provision) per ticker and period, copied from production ir_kpi_facts on
23 Nov 2026 with the checksum-verified transfer (last field = first 6 hex of md5 of the rest of the
line). Queries: /home/claude/fu/round3/reports/iracc_data/sql/. b01 rows: ticker|line|end|months|
value|tables printing it|newest filing|vintages; b06+ rows: ticker|line|end|months|values (most
printed first). Used by sec-check.test.ts and twins.test.ts.
