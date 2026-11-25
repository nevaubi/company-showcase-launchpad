# ABS-EE fixtures

Small pieces of real, public SEC files, used by the tests in `src/lib/abs/`. All four come from one filing: Form ABS-EE of BANK5 Trust 2024-5YR6, accession 0001888524-24-009544, filed 2024-06-28 (`https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/`).

- `cmbs-ex102-excerpt.xml`: the root element and six of the 70 `<assets>` records of the asset data file `exh_102.xml` (records 8, 9, 10, 42, 43 and 44), copied byte for byte: a loan split into notes (3, 3A, 3B) and a two-property loan whose properties are filed in records of their own (26, 26-001, 26-002).
- `abs-ee.hdr.sgml`: the filing header, without its business and mailing address blocks.
- `abs-ee-index.htm`: the "Document Format Files" table of the filing's index page.
- `submissions.json`: nine rows of the trust's EDGAR submissions index, with only the columns the reader uses.

Nothing in these files was edited apart from what is left out.
