# Company official-record fixtures

`store.json` holds real rows of the production official-source store, copied on 25 Nov 2026 with the
checksum-verified transfer of round 2 (every transfer passed `linecheck.py`), and
built from those files by a script, not by hand. Only the fields the company panels read are kept; text cells
were folded as TRANSFER.md prescribes (a `|`, quote or backslash replaced, non-ASCII as `?`).

| Snapshot | Dataset | What is kept |
| --- | --- | --- |
| `5161b586…ac2ddf` | `official_fdic_2026q2_cohort500_native_current_quarter` | 13 field descriptors; the 2026-09-30 rows of 18 banks (JPM 628, MCHB 1768, UNH 57408, 15 Wintrust banks) |
| `cc6fa800…ba817` | `official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b` | 13 descriptors; 106 quarters (2000-03-31 to 2026-06-30) of certificates 628, 1768 and 33935 |
| `8e5663ec…c18b` | `official_01_financials_data_latest_all_banks_core_796bc99364` | 9 identity descriptors; the rows of the 21 institutions of JPM, MCHB, UNH and WTFC |
| `eaa74358…7948` | `official_01_financials_data_fed_y9_family_all_native_2026q1_q3_ffceb6e988` | 13 descriptors; the FR Y-9C rows of JPM (17, 497, 4077), WTFC (232, 2341, 4291), MCHB (375, 3408, 4429) |
| `e2dfd50a…adcc` | `official_01_financials_data_fed_y9_official_variable_dictionary_433523f87c` | 5 descriptors; the rows of the 11 variables the panel labels |

Transfer files (scratch of unit company, not in git): `{fdic_dict,other_dict_meta,fdic_current,hist_1768_{1,2},hist_628_{1,2},hist_33935_{1,2},y9_ident_vars}.txt.ok`.
`fake-store.ts` answers the panels' selects and member functions from these rows.

Orange Book (added 25 Nov 2026, same transfer): products (22 rows), patents (91) and exclusivity (32) of Bristol Myers Squibb's applications 005657, 021880, 021986, 202155, 209606, 221075 and Exelixis' 203756, from snapshots 5e77f822…, 60c0c879… and c7553d3c… (files retrieved 24 Nov 2026). Every cell kept; text folded as TRANSFER.md says (none needed folding).
