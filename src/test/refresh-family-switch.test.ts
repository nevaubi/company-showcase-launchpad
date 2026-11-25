// A switch per refreshed family (review rev-workers M1.1): FRED can be stopped on the worker without
// stopping EIA, FHFA, FDIC and Taiwan, and every publisher is told who is asking (S8).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEC_UA } from "@/lib/sec.server";
import {
  OFFICIAL_USER_AGENT,
  REFRESH_FAMILY_SWITCH,
  refreshFamilyDisabledReason,
  refreshFamilyEnabled,
  type RefreshSwitchFamily,
} from "@/lib/sources/refresh-plan";

const FAMILIES = Object.keys(REFRESH_FAMILY_SWITCH) as RefreshSwitchFamily[];
/** The files that call a publisher with a header of their own. */
const COLLECTORS = ["scripts/lib/fdic-native.ts", "scripts/lib/taiwan-revenue-native.ts"];

describe("family switches of the official-source refresh", () => {
  it("names one worker variable per family", () => {
    expect(REFRESH_FAMILY_SWITCH).toEqual({
      fred: "OFFICIAL_FRED_ENABLED",
      eia_mer: "OFFICIAL_EIA_MER_ENABLED",
      fhfa: "OFFICIAL_FHFA_ENABLED",
      fdic: "OFFICIAL_FDIC_NATIVE_ENABLED",
      taiwan: "OFFICIAL_TAIWAN_REVENUE_ENABLED",
    });
  });

  it("leaves every family on when nothing is set", () => {
    for (const family of FAMILIES) {
      expect(refreshFamilyEnabled(family, {}), family).toBe(true);
      expect(refreshFamilyDisabledReason(family, {}), family).toBeNull();
    }
  });

  it("OFFICIAL_FRED_ENABLED=0 stops FRED and nothing else", () => {
    const env = { OFFICIAL_FRED_ENABLED: "0" };
    expect(FAMILIES.filter((family) => !refreshFamilyEnabled(family, env))).toEqual(["fred"]);
    expect(refreshFamilyDisabledReason("fred", env)).toBe("Refresh of this family is switched off by OFFICIAL_FRED_ENABLED=0.");
  });

  it("each of the other switches stops only its own family", () => {
    for (const family of FAMILIES) {
      const env = { [REFRESH_FAMILY_SWITCH[family]]: "0" };
      expect(FAMILIES.filter((f) => !refreshFamilyEnabled(f, env)), family).toEqual([family]);
    }
  });

  it("is off only for a clear no, so a value already set on the worker keeps its old meaning", () => {
    for (const value of ["0", "false", "FALSE", "off", "no", " 0 "]) expect(refreshFamilyEnabled("fred", { OFFICIAL_FRED_ENABLED: value }), value).toBe(false);
    // the FDIC and Taiwan variables were "off only at 0" before; any other value stays on
    for (const value of ["1", "true", "on", "yes", "", "enabled"])
      expect(refreshFamilyEnabled("fdic", { OFFICIAL_FDIC_NATIVE_ENABLED: value }), value).toBe(true);
  });
});

describe("user agent of the official-source collectors", () => {
  it("is the app's contact line, the same one the SEC lane sends", () => {
    expect(OFFICIAL_USER_AGENT).toBe("FiledUnder Research research@filedunder.ai");
    expect(OFFICIAL_USER_AGENT).toBe(SEC_UA);
  });

  it("is the only user agent the native collectors send: no other literal in the files that call a publisher", () => {
    for (const file of COLLECTORS) {
      const source = readFileSync(file, "utf8");
      expect(source.match(/["']User-Agent["']\s*:\s*["'`]/g), file).toBeNull();
      expect(source, file).not.toMatch(/official-source collector|official-data refresh/);
      expect(source, file).toContain('"User-Agent": OFFICIAL_USER_AGENT');
    }
  });
});
