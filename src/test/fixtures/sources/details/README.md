# Official dataset details (test fixtures)

Answers of `source_get_dataset` for nine production datasets of different shapes, copied on 25 Nov 2026 from the
unit `ux` preview kit (`/home/claude/wt/r4-ux/.preview/fx/sources/detail/`, built from production rows with the
checksum-verified transfer; its README says what each file holds). `file` (chunk paths and provenance) is dropped
from every copy. Stored strings are kept exactly; two stored dataset names contain U+2014, written here as the JSON
escape `\u2014`, which parses to the same string.

| File | Dataset | Shape facts |
| --- | --- | --- |
| `frb-daily-weekly.json` | `official_00_universal_daily_weekly_f0d4dafad8` | 6 fields, entity id (series code), no period index |
| `fred-ccsa.json` | `official_00_universal_raw_fred_ccsa_1f53c3efc9` | 2 fields, period only |
| `eia-mer.json` | `official_04_energy_csv_monthly_energy_2024_onward_1bf877c69e` | 4 fields, entity (series) and period `YYYYMM` |
| `msha-coal.json` | `official_04_energy_csv_msha_coal_employment_production_2000_2026_full_d3f430059d` | 11 fields, entity, place, year |
| `usgs-copper.json` | `official_07_materials_csv_ds140_ds140_copper_2020_copper_fe7a2ceced` | 13 fields, year only, marker NA |
| `fhfa-hpi-master.json` | `official_11_real_estate_hpi_master_all_0755e8292e` | 12 fields, place (with a level field) and period |
| `twse-revenue.json` | `official_twse_monthly_revenue_native_current` | 14 fields, entity, the period a constant (one ROC month) |
| `fdic-sod-branches.json` | `official_01_financials_data_fdic_top500_2026_all_sod_branches_dbdabfd5ea` | 81 fields, entity, place, period; no blank counts held |
| `fdic-panel.json` | `official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b` | see below |

`fdic-panel.json` is not a whole answer: the dictionary of 2,379 fields is 1.64 MB in production and 0.44 MB even in
the preview kit. It holds the dataset row and the snapshot without `columns` (`columns: null`), `columns_total`
(2379), `columns_complete` (the 18 complete descriptors, each with its `position`) and `columns_shape` (label, native
type and unit of the four fields its ingest declares as dimensions, at positions 0, 1, 1176, 2050). Tests that need
the full width build it from these, as `first-look.test.ts` does. Blank counts are not held for the two FDIC tables.
