import { describe, expect, it } from "vitest";
import { collapseDocCopies } from "./dedupe";

describe("one library row per document", () => {
  // PNC, 15 Jul 2026: the IR-site PDF of the Q2 release was skipped as a duplicate of the 8-K exhibit.
  const exhibit = { id: "dd4bf281-f736-458f-8ec0-c6b996d9ffa8", extract_status: "ok (2 rejected)", ext: "htm" };
  const pdf = { id: "38cc35f5-4798-4b0e-8628-dd4b711cfe70", extract_status: "skipped:duplicate of dd4bf281-f736-458f-8ec0-c6b996d9ffa8", ext: "pdf" };
  const lone = { id: "c60370a0-a6da-4faa-8ea0-0c904002fbc6", extract_status: "skipped:duplicate of 0dd03b69-4ab5-42d8-ad94-430462fc665b", ext: "pdf" };
  it("folds a skipped copy under the document that was read", () => {
    const { docs, copies } = collapseDocCopies([exhibit, pdf]);
    expect(docs).toEqual([exhibit]);
    expect(copies.get(exhibit.id)).toEqual([pdf]);
  });
  it("keeps a copy whose original is not listed", () => {
    expect(collapseDocCopies([exhibit, lone]).docs).toEqual([exhibit, lone]);
  });
});
