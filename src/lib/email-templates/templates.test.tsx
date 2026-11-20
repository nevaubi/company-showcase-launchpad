import { describe, expect, it } from "vitest";
import * as React from "react";
import { render } from "@react-email/render";
import { TEMPLATES } from "./registry";

const NAMES = ["waitlist-receipt", "waitlist-owner-notice", "waitlist-approved", "waitlist-reminder", "firm-invite", "ops-alert"];

describe("email templates", () => {
  it("registers all six", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...NAMES].sort());
  });
  for (const name of NAMES) {
    it(`${name} renders html and plain text in house style`, async () => {
      const t = TEMPLATES[name];
      const el = React.createElement(t.component, t.previewData ?? {});
      const html = await render(el);
      const text = await render(el, { plainText: true });
      const subject = typeof t.subject === "function" ? t.subject(t.previewData ?? {}) : t.subject;
      expect(html).toContain("FiledUnder");
      expect(text.length).toBeGreaterThan(80);
      for (const s of [subject, text]) {
        expect(s).not.toMatch(/—|!|Filed Under/);
      }
      expect(html).not.toMatch(/<img/i);
    });
  }
  it("approval email carries the email-bound sign-up link", async () => {
    const t = TEMPLATES["waitlist-approved"];
    const text = await render(React.createElement(t.component, t.previewData), { plainText: true });
    expect(text).toContain("email=ada%40firm.com");
  });
});
