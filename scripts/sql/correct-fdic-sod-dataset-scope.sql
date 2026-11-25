-- Correct the record grain of two retained SOD aggregates, not their immutable source values.
-- Verified 2026-11-25: all 500 bank and 1,716 bank-state groups reconcile exactly to
-- the 55,060 retained 2026 branch rows (counts, deposit sums, state counts and valid deposits).
-- This guarded, atomic correction does not change snapshots, native records, source files,
-- pointers, ingest specifications, access policies, or the refresh schedule.
DO $$
DECLARE matched integer;
BEGIN
  PERFORM id FROM public.source_datasets
  WHERE id IN (
    'official_01_financials_data_fdic_top500_2026_sod_bank_totals_41b1214439',
    'official_01_financials_data_fdic_top500_2026_sod_by_bank_state_a65c3ff1ec'
  ) FOR UPDATE;

  UPDATE public.source_datasets SET
    name = 'FDIC · 2026 Summary of Deposits · Bank totals',
    grain = 'Insured institution (CERT) × survey year',
    units = 'Branch and state counts; branch deposits in USD thousands as labelled in the retained file.',
    description = 'Retained bank-level aggregation of the 2026 FDIC Summary of Deposits branch collection. Original collection: 500 aggregate rows and 7 columns.',
    notes = 'Each row aggregates the retained branch records for one insured institution CERT in survey year 2026. The 500 bank rows reconcile exactly to the retained 55,060 branch rows for branch counts, state/territory counts, deposits and branches with a deposit value. Deposits remain in the retained USD-thousands unit; no value was converted. This aggregate overlaps the branch collection and is not an additional independent population. Bank ASSET is not summed. Aggregation reconciliation was performed on 2026-11-25. Original file bytes and native cells are unchanged. Retrieval time does not establish historical public availability.',
    updated_at = now()
  WHERE id = 'official_01_financials_data_fdic_top500_2026_sod_bank_totals_41b1214439'
    AND latest_snapshot_id = '5f256d95148ca37de19d9cdae591c56f0cc52d55b2a49c876ca786871414756f'
    AND updated_at = '2026-11-25 05:31:17.444854+00'::timestamptz;
  GET DIAGNOSTICS matched = ROW_COUNT;
  IF matched <> 1 THEN RAISE EXCEPTION 'SOD bank-total snapshot changed; inspect before applying the scope correction'; END IF;

  UPDATE public.source_datasets SET
    name = 'FDIC · 2026 Summary of Deposits · Bank-state totals',
    grain = 'Insured institution (CERT) × branch state · 2026 survey',
    units = 'Branch counts; branch deposits in USD thousands as labelled in the retained file.',
    description = 'Retained bank-by-state aggregation of the 2026 FDIC Summary of Deposits branch collection. Original collection: 1,716 aggregate rows and 5 columns.',
    notes = 'Each row aggregates the retained 2026 branch records for one insured institution CERT and branch-state abbreviation STALPBR. All 1,716 bank-state rows reconcile exactly to branch counts and deposit sums from the retained 55,060 branch records. The 2026 survey scope is established by the underlying branch file; this aggregate has no native year column. Deposits remain in the retained USD-thousands unit; no value was converted. This aggregate overlaps the branch and bank-total collections and is not an additional independent population. Bank ASSET is not summed. Aggregation reconciliation was performed on 2026-11-25. Original file bytes and native cells are unchanged. Retrieval time does not establish historical public availability.',
    updated_at = now()
  WHERE id = 'official_01_financials_data_fdic_top500_2026_sod_by_bank_state_a65c3ff1ec'
    AND latest_snapshot_id = '4e3df7aa86492c7fbcfe265b7ee49dedaf7ddc70a2ad48d236a0e0fc4d957a63'
    AND updated_at = '2026-11-25 05:31:13.992092+00'::timestamptz;
  GET DIAGNOSTICS matched = ROW_COUNT;
  IF matched <> 1 THEN RAISE EXCEPTION 'SOD bank-state snapshot changed; inspect before applying the scope correction'; END IF;
END $$;
