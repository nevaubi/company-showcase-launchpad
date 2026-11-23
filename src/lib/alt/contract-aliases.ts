// Hand-checked USAspending recipient names that belong to a covered company but are not its legal
// name: subsidiaries and former names. Names are written exactly as USAspending prints them (read
// from api.usaspending.gov/api/v2/recipient/ on 2026-11-20), and every entry cites what ties it to
// the company: the company's own 10-K subsidiary list (Exhibit 21) or its SEC name history
// (`formerNames` in the EDGAR submissions file). A name that neither source lists is left out, even
// when it looks like the company's (Google Public Sector LLC is not in Alphabet's Exhibit 21, so it
// is not here). A recipient matches an alias only by whole name: the same name core and the same
// legal form (src/lib/alt/contracts.ts `isCompanyName`).
//
// `ueis`: the recipient's UEIs where USAspending lists it as its own parent (P level), so the
// collector looks it up directly and collects its awards and children. Amazon Web Services, KBR
// Wyle and V2X Aerospace are parents of their own in USAspending, not children of the company.
// Pure data.

export interface ContractAlias {
  /** Recipient name as USAspending prints it. */
  name: string;
  /** UEIs of the recipient where USAspending lists it at parent level. */
  ueis?: string[];
  /** What ties the name to the company. */
  source: string;
}

const ex21 = (form: string, url: string) => `${form} Exhibit 21 subsidiary list, ${url}`;
const former = (name: string, years: string) => `SEC name history: the registrant was "${name}" ${years}`;

const RTX_21 = ex21("10-K FY2025 (filed 2026-02-06)", "https://www.sec.gov/Archives/edgar/data/101829/000010182926000006/exhibit212025-12x3110xk.htm");
const AMZN_21 = ex21("10-K FY2025 (filed 2026-02-06)", "https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/amzn-20251231xex211.htm");
const GOOGL_21 = ex21("10-K FY2025 (filed 2026-02-05)", "https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/googexhibit2101q42025.htm");
const HUM_21 = ex21("10-K FY2025 (filed 2026-02-19)", "https://www.sec.gov/Archives/edgar/data/49071/000004907126000009/hum-20251231x10kxex21.htm");
const KBR_21 = ex21("10-K FY2025 (filed 2026-02-26)", "https://www.sec.gov/Archives/edgar/data/1357615/000135761526000051/kbr-ex211x01022026.htm");
const VVX_21 = ex21("10-K FY2025 (filed 2026-02-23)", "https://www.sec.gov/Archives/edgar/data/1601548/000160154826000015/exhibit21-subsidiaries1231.htm");
const LHX_21 = ex21("10-K FY2025 (filed 2026-02-12)", "https://www.sec.gov/Archives/edgar/data/202058/000020205826000015/a10-kexhibit21cy25xq4.htm");
const MDT_21 = ex21("10-K FY2026 (filed 2026-06-18)", "https://www.sec.gov/Archives/edgar/data/1613103/000162828026044354/mdt-202610kxex21.htm");
const LIN_21 = ex21("10-K FY2025 (filed 2026-02-25)", "https://www.sec.gov/Archives/edgar/data/1707925/000162828026011430/lindeplc10k-ex2101.htm");
const STE_21 = ex21("10-K FY2026 (filed 2026-05-29)", "https://www.sec.gov/Archives/edgar/data/1757898/000162828026039136/ste03312026ex211.htm");
const NE_21 = ex21("10-K FY2025 (filed 2026-02-12)", "https://www.sec.gov/Archives/edgar/data/1895262/000189526226000076/exhibit211-listofsubsidiar.htm");
const ETN_21 = ex21("10-K FY2025 (filed 2026-02-26)", "https://www.sec.gov/Archives/edgar/data/1551182/000155118226000007/etn12312025ex21.htm");
const CW_21 = ex21("10-K FY2025 (filed 2026-02-12)", "https://www.sec.gov/Archives/edgar/data/26324/000162828026007587/exhibit21_20251231.htm");
const GD_21 = ex21("10-K FY2025 (filed 2026-01-30)", "https://www.sec.gov/Archives/edgar/data/40533/000004053326000006/ex21-20251231.htm");
const ACN_21 = ex21("10-K FY2026 (filed 2026-10-16)", "https://www.sec.gov/Archives/edgar/data/1467373/000146737326000049/a831202610-kexhibit211.htm");
const CNC_21 = ex21("10-K FY2025 (filed 2026-02-17)", "https://www.sec.gov/Archives/edgar/data/1071739/000107173926000049/a2025123110-kexhibit21.htm");
const ORCL_21 = ex21("10-K FY2026 (filed 2026-06-22)", "https://www.sec.gov/Archives/edgar/data/1341439/000119312526277521/orcl-ex21_01.htm");
const JNJ_21 = ex21("10-K FY2025 (filed 2026-02-11)", "https://www.sec.gov/Archives/edgar/data/200406/000020040626000016/ex21-subsidiariesxform10xk.htm");
const DELL_21 = ex21("10-K FY2026 (filed 2026-03-16)", "https://www.sec.gov/Archives/edgar/data/1571996/000157199626000008/exhibit211fy2610-k.htm");
const CACI_21 = ex21("10-K FY2026 (filed 2026-08-06)", "https://www.sec.gov/Archives/edgar/data/16058/000162828026054195/caci20260630ex211.htm");

export const CONTRACT_ALIASES: Record<string, ContractAlias[]> = {
  RTX: [
    { name: "RTX CORPORATION", ueis: ["PPLZG8J3N9D4"], source: "SEC company name RTX Corp (the recipient is the registrant itself)" },
    { name: "RAYTHEON COMPANY", source: RTX_21 },
    { name: "RAYTHEON TECHNOLOGIES CORPORATION", source: former("RAYTHEON TECHNOLOGIES CORP", "2020-04 to 2023-06") },
    { name: "UNITED TECHNOLOGIES CORPORATION", source: former("UNITED TECHNOLOGIES CORP /DE/", "1994-01 to 2020-04") },
  ],
  AMZN: [
    { name: "AMAZON WEB SERVICES, INC.", ueis: ["NQEWN6C1LSU5", "H6S2VKM5U6C5"], source: AMZN_21 },
    { name: "AMAZON.COM SERVICES LLC", ueis: ["TMKBFBRHFKH3"], source: AMZN_21 },
  ],
  GOOGL: [{ name: "GOOGLE LLC", source: GOOGL_21 }],
  HUM: [{ name: "HUMANA GOVERNMENT BUSINESS INC", ueis: ["ZE6ZM6NKSV43"], source: HUM_21 }],
  KBR: [
    { name: "KBR WYLE SERVICES, LLC", ueis: ["TGPKTMN8YL31"], source: KBR_21 },
    { name: "KBR SERVICES, LLC", source: KBR_21 },
    { name: "KBR DIEGO GARCIA, LLC", ueis: ["F6U3MGTBLM69"], source: KBR_21 },
  ],
  VVX: [
    { name: "V2X AEROSPACE LLC", ueis: ["NVC1EFKKYB93"], source: VVX_21 },
    { name: "V2X SYSTEMS LLC", source: VVX_21 },
    { name: "VECTRUS SYSTEMS LLC", source: VVX_21 },
    { name: "VECTRUS, INC.", source: former("Vectrus, Inc.", "until 2022-07") },
  ],
  LHX: [
    { name: "HARRIS CORPORATION", source: former("HARRIS CORP /DE/", "until 2019-06") },
    { name: "L3 TECHNOLOGIES, INC.", ueis: ["FRJQGQHDX4J3", "VJGEGN9GZM11"], source: LHX_21 },
  ],
  MDT: [
    { name: "MEDTRONIC, INC.", source: MDT_21 },
    { name: "MEDTRONIC USA, INC.", source: MDT_21 },
    { name: "MEDTRONIC MINIMED, INC", source: MDT_21 },
    { name: "COVIDIEN LP", ueis: ["MRMPJAMHMAY3"], source: MDT_21 },
  ],
  LIN: [
    { name: "LINDE INC.", ueis: ["M7MKJAE99XA2"], source: LIN_21 },
    { name: "LINDE GAS & EQUIPMENT INC.", ueis: ["PBGNFLNFRWB9"], source: LIN_21 },
    { name: "LINDE ENGINEERING NORTH AMERICA LLC", source: LIN_21 },
  ],
  STE: [
    { name: "STERIS CORPORATION", ueis: ["UGGQJGGH6846"], source: STE_21 },
    { name: "STERIS INSTRUMENT MANAGEMENT SERVICES, INC", ueis: ["NL5RN24J2BF9"], source: STE_21 },
  ],
  NE: [{ name: "NOBLE CORPORATION", source: NE_21 }],
  ETN: [
    { name: "EATON CORPORATION", ueis: ["NP3NSFVMNUM3"], source: ETN_21 },
    { name: "EATON AEROSPACE, LLC", ueis: ["UPAPN5VL4KR9"], source: ETN_21 },
  ],
  CW: [
    { name: "CURTISS-WRIGHT FLOW CONTROL SERVICE, LLC", ueis: ["J9V9SJL4CW97", "NGCRKJERS5T1"], source: CW_21 },
    { name: "CURTISS-WRIGHT ELECTRO-MECHANICAL CORPORATION", ueis: ["HLQLWMV97J37"], source: CW_21 },
  ],
  GD: [{ name: "GENERAL DYNAMICS LAND SYSTEMS INC.", ueis: ["HAWKSQF848W7"], source: GD_21 }],
  ACN: [{ name: "ACCENTURE FEDERAL SERVICES LLC", source: ACN_21 }],
  CNC: [{ name: "HEALTH NET FEDERAL SERVICES, LLC", ueis: ["F7NGF6NJFB96"], source: CNC_21 }],
  ORCL: [{ name: "ORACLE AMERICA, INC.", ueis: ["HE98WLUBNW88"], source: ORCL_21 }],
  JNJ: [{ name: "JOHNSON & JOHNSON HEALTH CARE SYSTEMS INC.", source: JNJ_21 }],
  DELL: [
    { name: "DELL FEDERAL SYSTEMS L.P", source: DELL_21 },
    { name: "DELL MARKETING L.P.", source: DELL_21 },
  ],
  CACI: [
    { name: "CACI, INC. - FEDERAL", source: CACI_21 },
    { name: "CACI NSS, LLC", ueis: ["Y9CDLHK3A125"], source: CACI_21 },
  ],
};
