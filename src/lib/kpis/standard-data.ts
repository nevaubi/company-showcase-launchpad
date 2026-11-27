import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { partnerFile } from "@/lib/data";
import {
  reviewedBankCompany,
  reviewedBankLatest,
  standaloneBankCompany,
  isReviewedBank,
  type StandardLatest,
  type StdCompany,
} from "./verified-bank";

function useVerifiedBankPoints() {
  return useQuery({
    queryKey: ["verified-bank-kpi-points"],
    queryFn: async () => {
      const { data, error } = await supabase.from("verified_bank_kpi_points").select("*");
      if (error) throw error;
      return data.map((p) => ({ ...p, amount_usd: Number(p.amount_usd) }));
    },
    staleTime: 3600_000,
    retry: 1,
  });
}

export function useStandardLatest() {
  const verified = useVerifiedBankPoints();
  const source = useQuery({
    queryKey: ["kpistd", "latest"],
    queryFn: () => partnerFile<StandardLatest>("kpistd/latest.json"),
    staleTime: 3600_000,
    retry: 1,
  });
  const data = useMemo(
    () => source.data && reviewedBankLatest(source.data, verified.data ?? []),
    [source.data, verified.data],
  );
  return { ...source, data };
}

export function useStandardCompany(ticker: string) {
  const verified = useVerifiedBankPoints();
  const source = useQuery({
    queryKey: ["kpistd", "t", ticker],
    queryFn: () => partnerFile<StdCompany>(`kpistd/t/${ticker}.json`),
    staleTime: 3600_000,
    retry: 1,
  });
  const data = useMemo(
    () =>
      source.data
        ? reviewedBankCompany(source.data, verified.data ?? [])
        : standaloneBankCompany(ticker, verified.data ?? []),
    [source.data, verified.data, ticker],
  );
  return {
    ...source,
    data,
    filingOnly: !source.data && !!data,
    verificationFailed: isReviewedBank(ticker) && verified.isError,
    verificationPending: isReviewedBank(ticker) && verified.isPending,
  };
}
