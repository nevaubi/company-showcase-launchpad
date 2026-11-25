import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assetFiles,
  dealOf,
  familyOfClass,
  filingFolder,
  headerUrl,
  indexUrl,
  listedFilings,
  olderPages,
  parseAbsHeader,
  parseFilingIndex,
  submissionsUrl,
  type AbsHeader,
} from "./edgar";

// Real EDGAR files of one filing (address and phone lines left out; see fixtures/abs/README.md).
const HEADER = readFileSync("src/test/fixtures/abs/abs-ee.hdr.sgml", "utf8");
const INDEX = readFileSync("src/test/fixtures/abs/abs-ee-index.htm", "utf8");
const SUBMISSIONS = JSON.parse(readFileSync("src/test/fixtures/abs/submissions.json", "utf8"));

describe("abs EDGAR files", () => {
  it("lists only ABS-EE filings of a submissions file, with the acceptance time as UTC", () => {
    const rows = listedFilings(SUBMISSIONS, 2017898);
    expect(rows.length).toBe(4);
    expect(new Set(rows.map((r) => r.form))).toEqual(new Set(["ABS-EE"]));
    for (const r of rows) {
      expect(r.accession).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      expect(r.filed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
      expect(r.list_cik).toBe(2017898);
    }
  });

  it("reads older pages (columns at the top) and takes amendments, and drops rows it cannot key", () => {
    const page = {
      accessionNumber: [
        "0001234567-20-000001",
        "0001234567-20-000002",
        "bad",
        "0001234567-20-000004",
        "0001234567-20-000005",
      ],
      form: ["ABS-EE/A", "10-D", "ABS-EE", "ABS-EE", "ABS-EE"],
      filingDate: ["2020-02-01", "2020-02-01", "2020-02-01", "20200201", "2020-03-01"],
      acceptanceDateTime: ["2020-02-01T21:00:00.000Z", "", "", "", "not a time"],
    };
    expect(listedFilings(page, 99)).toEqual([
      {
        accession: "0001234567-20-000001",
        list_cik: 99,
        form: "ABS-EE/A",
        filed: "2020-02-01",
        accepted_at: "2020-02-01T21:00:00.000Z",
      },
      {
        accession: "0001234567-20-000005",
        list_cik: 99,
        form: "ABS-EE",
        filed: "2020-03-01",
        accepted_at: null,
      },
    ]);
    expect(
      olderPages({
        filings: {
          files: [{ name: "CIK0001234567-submissions-001.json" }, { name: "../../etc/passwd" }],
        },
      }),
    ).toEqual(["CIK0001234567-submissions-001.json"]);
    expect(olderPages(SUBMISSIONS)).toEqual([]);
  });

  it("builds the archive addresses from the CIK that lists the filing", () => {
    expect(submissionsUrl(2017898)).toBe("https://data.sec.gov/submissions/CIK0002017898.json");
    expect(filingFolder(2017898, "0001888524-24-009544")).toBe(
      "https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/",
    );
    expect(headerUrl(2017898, "0001888524-24-009544")).toBe(
      "https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/0001888524-24-009544.hdr.sgml",
    );
    expect(indexUrl(2017898, "0001888524-24-009544")).toBe(
      "https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/0001888524-24-009544-index.htm",
    );
  });

  it("reads the cover period, the asset class and the parties from a real header", () => {
    const h = parseAbsHeader(HEADER);
    expect(h).toEqual({
      accession: "0001888524-24-009544",
      form: "ABS-EE",
      filed: "2024-06-28",
      periodStart: "2024-05-06",
      periodEnd: "2024-06-17",
      acceptedAt: "2024-06-28 10:39:16 America/New_York",
      assetClasses: ["Commercial mortgages"],
      depositorCik: 1013611,
      sponsorCik: 835271,
      filers: [
        {
          cik: 2017898,
          name: "BANK5 Trust 2024-5YR6",
          form: "ABS-EE",
          fileNumber: "333-258342-04",
        },
      ],
    });
    expect(dealOf(h)).toEqual({
      deal_id: "0002017898",
      issuer_cik: 2017898,
      issuer_name: "BANK5 Trust 2024-5YR6",
      file_number: "333-258342-04",
    });
    expect(() => parseAbsHeader("<html>not found</html>")).toThrowError(
      /not an EDGAR filing header/,
    );
    expect(() => parseAbsHeader(HEADER.replace(/<TYPE>ABS-EE\n/, ""))).toThrowError(
      /not an EDGAR filing header/,
    );
    // a header may list several asset classes (seen on a commercial mortgage trust: "Auto loans", then "Commercial mortgages")
    const two = parseAbsHeader(
      HEADER.replace(
        "<ABS-ASSET-CLASS>Commercial mortgages\n",
        "<ABS-ASSET-CLASS>Auto loans\n<ABS-ASSET-CLASS>Commercial mortgages\n",
      ),
    );
    expect(two.assetClasses).toEqual(["Auto loans", "Commercial mortgages"]);
    expect(
      parseAbsHeader(HEADER.replace("<ABS-ASSET-CLASS>Commercial mortgages\n", "")).assetClasses,
    ).toEqual([]);
    // a header that leaves the period out says so with nulls, not with a guess
    const bare = parseAbsHeader(
      HEADER.replace(/<PERIOD>\d+\n/, "")
        .replace(/<PERIOD-START>\d+\n/, "")
        .replace(/<ACCEPTANCE-DATETIME>\d+\n/, ""),
    );
    expect([bare.periodStart, bare.periodEnd, bare.acceptedAt]).toEqual([null, null, null]);
  });

  it("names the deal by the issuing entity, or by depositor and file number, and never guesses", () => {
    const base: AbsHeader = { ...parseAbsHeader(HEADER), filers: [] };
    const trust = { cik: 2017898, name: "Trust", form: "ABS-EE", fileNumber: "333-1-04" };
    const depositor = { cik: 1013611, name: "Depositor LLC", form: "ABS-EE", fileNumber: "333-1" };
    expect(dealOf({ ...base, filers: [depositor, trust] })?.deal_id).toBe("0002017898");
    expect(dealOf({ ...base, filers: [trust, depositor] })?.issuer_name).toBe("Trust");
    // only the depositor files (several trusts share its CIK): the file number tells the trusts apart
    expect(dealOf({ ...base, filers: [{ ...depositor, fileNumber: "333-1-07" }] })).toEqual({
      deal_id: "0001013611:333-1-07",
      issuer_cik: null,
      issuer_name: "Depositor LLC",
      file_number: "333-1-07",
    });
    expect(dealOf({ ...base, filers: [{ ...depositor, fileNumber: null }] })).toBeNull();
    expect(dealOf({ ...base, filers: [] })).toBeNull();
    // two filers that are both not the depositor: no single issuing entity
    expect(dealOf({ ...base, filers: [trust, { ...trust, cik: 5 }] })).toBeNull();
    expect(dealOf({ ...base, depositorCik: null, filers: [trust] })?.deal_id).toBe("0002017898");
  });

  it("lists a filing's documents from its index page and picks the asset data file", () => {
    const docs = parseFilingIndex(INDEX);
    expect(docs).toEqual([
      {
        seq: 1,
        description: null,
        name: "bak24yr6_absee-202406.htm",
        url: "https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/bak24yr6_absee-202406.htm",
        doc_type: "ABS-EE",
        listed_bytes: 5670,
      },
      {
        seq: 2,
        description: null,
        name: "exh_102.xml",
        url: "https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/exh_102.xml",
        doc_type: "EX-102",
        listed_bytes: 345077,
      },
      {
        seq: 3,
        description: null,
        name: "exh_103.xml",
        url: "https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/exh_103.xml",
        doc_type: "EX-103",
        listed_bytes: 7128,
      },
    ]);
    expect(assetFiles(docs).map((d) => d.name)).toEqual(["exh_102.xml"]);
    expect(parseFilingIndex("<html>no table</html>")).toEqual([]);
    // an inline-viewer link and a described row; a link that leaves the archive is not a document
    const row = (cells: string) =>
      `<table class="tableFile" summary="Document Format Files"><tr>${cells}</tr></table>`;
    expect(
      parseFilingIndex(
        row(
          '<td>4</td><td>ASSET DATA &amp; MORE</td><td><a href="/ix?doc=/Archives/edgar/data/1/0001/a.xml">a.xml</a></td><td>EX-102</td><td>&nbsp;</td>',
        ),
      ),
    ).toEqual([
      {
        seq: 4,
        description: "ASSET DATA & MORE",
        name: "a.xml",
        url: "https://www.sec.gov/Archives/edgar/data/1/0001/a.xml",
        doc_type: "EX-102",
        listed_bytes: null,
      },
    ]);
    expect(
      parseFilingIndex(
        row(
          '<td>1</td><td></td><td><a href="https://example.com/a.xml">a.xml</a></td><td>EX-102</td><td>5</td>',
        ),
      ),
    ).toEqual([]);
    expect(
      assetFiles([
        {
          seq: 1,
          description: null,
          name: "ex102.pdf",
          url: "u",
          doc_type: "EX-102",
          listed_bytes: 1,
        },
      ]),
    ).toEqual([]);
  });

  it("maps the header's asset class words to a family", () => {
    expect(familyOfClass("Commercial mortgages")).toBe("cmbs");
    expect(familyOfClass("Auto loans")).toBe("auto_loan");
    expect(familyOfClass("Auto leases")).toBe("auto_lease");
    expect(familyOfClass("Residential mortgages")).toBe("other");
    expect(familyOfClass("Debt Securities")).toBe("other");
  });
});
