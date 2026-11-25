// The CIKs whose ABS-EE filings the scheduled job lists and stores. A CIK is either an issuing entity (a
// trust: its monthly files) or a depositor (the files made when its trusts are offered).
//
// The list starts from the 39 commercial mortgage rows of the workbook this data area was first checked
// against (39 CIKs, names as EDGAR writes them; three trusts appear both under their own CIK and under their depositor's). One trust is followed over its whole history;
// the others from RECENT on, which keeps the store small until someone decides how much history to hold
// (one trust's eight years of monthly files take about 10 MB). `bun scripts/abs-ee.ts` stores any CIK and
// any range by hand and is the tool for history and for files too large for a scheduled run.

export type AbsWatch = {
  cik: number;
  /** EDGAR's name for the CIK, for people reading this list */
  name: string;
  /** store filings filed on or after this day (YYYY-MM-DD); the whole history when left out */
  from?: string;
};

const RECENT = "2026-07-01";

export const ABS_WATCH: readonly AbsWatch[] = [
  { cik: 1948175, name: "3650R 2022-PF2 Commercial Mortgage Trust", from: RECENT },
  { cik: 1005007, name: "Banc of America Merrill Lynch Commercial Mortgage Inc.", from: RECENT },
  { cik: 2138709, name: "BANK 2026-BNK52", from: RECENT },
  {
    cik: 1694649,
    name: "Bank of America Merrill Lynch Commercial Mortgage Trust 2017-BNK3",
    from: RECENT,
  },
  { cik: 2017898, name: "BANK5 Trust 2024-5YR6", from: RECENT },
  { cik: 1541480, name: "Barclays Commercial Mortgage Securities LLC", from: RECENT },
  { cik: 1981769, name: "BBCMS 2023-C20", from: RECENT },
  { cik: 2152423, name: "BBCMS Mortgage Trust 2026-M1", from: RECENT },
  { cik: 1921064, name: "BENCHMARK 2022-B35 MORTGAGE TRUST", from: RECENT },
  { cik: 2063009, name: "BMO 2026-C15 Mortgage Trust", from: RECENT },
  { cik: 1861132, name: "BMO Commercial Mortgage Securities LLC", from: RECENT },
  { cik: 1720748, name: "CCUBS Commercial Mortgage Trust 2017-C1", from: RECENT },
  { cik: 1782003, name: "CD 2019-CD8 Mortgage Trust", from: RECENT },
  { cik: 1793744, name: "CF 2019-CF3 Mortgage Trust", from: RECENT },
  { cik: 1703075, name: "CFCRE 2017-C8 Mortgage Trust", from: RECENT },
  { cik: 1258361, name: "CITIGROUP COMMERCIAL MORTGAGE SECURITIES INC", from: RECENT },
  { cik: 1800294, name: "CITIGROUP COMMERCIAL MORTGAGE TRUST 2020-GC46", from: RECENT },
  { cik: 2143199, name: "Citigroup Commercial Mortgage Trust 2026-MFAM1", from: RECENT },
  { cik: 1792157, name: "COMM 2019-GC44 Mortgage Trust", from: RECENT },
  { cik: 1832873, name: "CSAIL 2021-C20 Commercial Mortgage Trust", from: RECENT },
  { cik: 1691198, name: "CSMC 2016-NXSR Commercial Mortgage Trust", from: RECENT },
  { cik: 2145996, name: "D2-Natixis Multifamily Mortgage Trust 2026-M1", from: RECENT },
  { cik: 1752363, name: "DBGS 2018-C1 Mortgage Trust" },
  { cik: 1818254, name: "DBJPM 2020-C9 Mortgage Trust", from: RECENT },
  { cik: 1013454, name: "DEUTSCHE MORTGAGE & ASSET RECEIVING CORP", from: RECENT },
  { cik: 1961629, name: "FIVE 2023-V1 Mortgage Trust", from: RECENT },
  { cik: 1004158, name: "GS MORTGAGE SECURITIES CORP II", from: RECENT },
  { cik: 1895116, name: "GS Mortgage Securities Trust 2021-GSA3", from: RECENT },
  { cik: 1013611, name: "JP MORGAN CHASE COMMERCIAL MORTGAGE SECURITIES CORP", from: RECENT },
  { cik: 1774801, name: "JPMCC Commercial Mortgage Securities Trust 2019-COR5", from: RECENT },
  { cik: 2134864, name: "JPMF1 Multifamily Mortgage Trust 2026-FX1", from: RECENT },
  {
    cik: 2145539,
    name: "Morgan Stanley Bank of America Merrill Lynch Trust 2026-C36",
    from: RECENT,
  },
  { cik: 1547361, name: "Morgan Stanley Capital I Inc.", from: RECENT },
  { cik: 1912724, name: "Morgan Stanley Capital I Trust 2022-L8", from: RECENT },
  { cik: 2002215, name: "MSWF Commercial Mortgage Trust 2023-2", from: RECENT },
  { cik: 1693143, name: "Natixis Commercial Mortgage Securities LLC", from: RECENT },
  { cik: 1793856, name: "UBS Commercial Mortgage Trust 2019-C18", from: RECENT },
  { cik: 1867467, name: "WELLS FARGO COMMERCIAL MORTGAGE TRUST 2021-C60", from: RECENT },
  { cik: 2109197, name: "Wells Fargo Commercial Mortgage Trust 2026-C66", from: RECENT },
];
