# ABS-EE fixtures

Small pieces of real, public SEC files, used by the tests in `src/lib/abs/`. The first four come from one filing: Form ABS-EE of BANK5 Trust 2024-5YR6, accession 0001888524-24-009544, filed 2024-06-28 (`https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/`).

- `cmbs-ex102-excerpt.xml`: the root element and six of the 70 `<assets>` records of the asset data file `exh_102.xml` (records 8, 9, 10, 42, 43 and 44), copied byte for byte: a loan split into notes (3, 3A, 3B) and a two-property loan whose properties are filed in records of their own (26, 26-001, 26-002).
- `abs-ee.hdr.sgml`: the filing header, without its business and mailing address blocks.
- `abs-ee-index.htm`: the "Document Format Files" table of the filing's index page.
- `submissions.json`: nine rows of the trust's EDGAR submissions index, with only the columns the reader uses.


Auto loans and leases:

- `autoloan-ex102-excerpt.xml`: the root element and ten of the 21,839 `<assets>` records of `wosat2026aex102sep26.xml`, Form ABS-EE of World Omni Select Auto Trust 2026-A, accession 0001104659-26-119913, filed 2026-10-29 (records 1, 2, 3, 6, 38, 76, 234, 256, 266 and 412), copied byte for byte: paid off, delinquent, charged off with a recovery, a negative balance, a repeated `subvented`, a score outside 300 to 900, no payment-to-income, and one above 1.
- `autoloan.hdr.sgml`, `autoloan-index.htm`: that filing's header without its address blocks, and the "Document Format Files" table of its index page.
- `autolease-ex102-excerpt.xml`: the root element and seven of the 12,617 records of the asset data file of Porsche Innovative Lease Owner Trust 2026-1, accession 0001104659-26-118758, filed 2026-10-26 (records 1, 7, 9, 22, 748, 2582 and 8021), copied byte for byte.
- `auto-excerpt-figures.json`: the figures of the two excerpts, computed by a separate program (Python, `Decimal`, regular expressions instead of an XML reader) from the definitions in `metrics.ts`. The tests compare the app's reader with it.

An auto asset record states the obligor's state and nothing else about a person.

Nothing in these files was edited apart from what is left out.
