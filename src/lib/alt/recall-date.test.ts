import { describe, expect, it } from "vitest";
import { recallEventDate } from "./collect.server";

describe("FDA recall event dates", () => {
  it("resolves the two documented CDRH initiation years", () => {
    expect(recallEventDate({ cfres_id: "117862", event_date_initiated: "0013-04-12", event_date_posted: "2013-05-29" })).toMatchObject({ date: "2013-04-12", basis: "firm_initiation" });
    expect(recallEventDate({ cfres_id: "122550", event_date_initiated: "0012-11-30", event_date_posted: "2013-11-04" })).toMatchObject({ date: "2012-11-30", basis: "firm_initiation" });
  });
  it("holds an unreviewed malformed year and labels the agency publication fallback", () => {
    expect(recallEventDate({ cfres_id: "other", event_date_initiated: "0013-04-12", event_date_posted: "2013-05-29" })).toMatchObject({ date: "2013-05-29", basis: "agency_publication" });
    expect(recallEventDate({ event_date_initiated: "0013-04-12" }).date).toBeNull();
  });
});
