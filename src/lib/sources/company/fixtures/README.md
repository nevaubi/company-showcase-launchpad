# Company chart fixtures (round 6)

`r6-store.json` holds real rows of the production official-source store, copied on 26 Nov 2026 with the
checksum-verified transfer of round 2 (every transfer passed `linecheck.py`) and built from those files by a script,
not by hand. Only the fields the company reads use are kept; text cells were folded as TRANSFER.md prescribes
(none needed it). `store-client.ts` answers the reads' selects and `source_query_records` from it.

| Snapshot | Dataset | What is kept |
| --- | --- | --- |
| `5161b586…ac2ddf` | `official_fdic_2026q2_cohort500_native_current_quarter` | 21 descriptors; the 2026-09-30 rows of certificates 3511, 5146, 27389 (Wells Fargo) and 6672 (Fifth Third) |
| `cc6fa800…ba817` | `official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b` | 21 descriptors; 106 quarters (2000-03-31 to 2026-06-30) of ASSET, DEP and NETINCQ for the four certificates; LNLSNET, NETINC and the six ratios only for 3511 and 6672 from 2020-03-31 (the quarters the ratio tiles draw) |
| `8e5663ec…c18b` | `official_01_financials_data_latest_all_banks_core_796bc99364` | 17 identity descriptors; the rows of the six Wells Fargo and Fifth Third institutions |
| `eaa74358…7948` | `official_01_financials_data_fed_y9_family_all_native_2026q1_q3_ffceb6e988` | 15 descriptors; the FR Y-9C rows of WFC (99, 1146, 4158) and FITB (39, 747, 4098) |
| `e2dfd50a…adcc` | `official_01_financials_data_fed_y9_official_variable_dictionary_433523f87c` | 3 descriptors; the rows of the 13 variables the panel labels |
| `4e3df7aa…7a63` | `official_01_financials_data_fdic_top500_2026_sod_by_bank_state_a65c3ff1ec` | 5 descriptors; the 57 branch-state rows of 3511, 5146, 27389 and 6672 |
| `5f256d95…756f` | `official_01_financials_data_fdic_top500_2026_sod_bank_totals_41b1214439` | 7 descriptors; the four institutions' totals |

Transfer files (scratch of unit company, round 6, not in git): `{meta,y9,rows,hist_3511,hist_6672,hist_small,hist_ratios,vars}.txt.ok`.
