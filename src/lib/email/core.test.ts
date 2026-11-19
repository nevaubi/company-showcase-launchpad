import { describe, expect, it } from "vitest";
import { backoffMs, capReached, classifySendError, idemKey, MAX_ATTEMPTS, rateLimit, waitlistSchema } from "./core";

describe("waitlist validation", () => {
  it("accepts a minimal entry and normalises the email", () => {
    const r = waitlistSchema.parse({ name: " Ada ", email: " Ada@Firm.COM " });
    expect(r).toMatchObject({ name: "Ada", email: "ada@firm.com" });
    expect(r.firm).toBeUndefined();
  });
  it("rejects a missing name and a bad email", () => {
    expect(waitlistSchema.safeParse({ name: "", email: "ada@firm.com" }).success).toBe(false);
    expect(waitlistSchema.safeParse({ name: "Ada", email: "not-an-email" }).success).toBe(false);
  });
  it("caps the use case at 500 characters", () => {
    expect(waitlistSchema.safeParse({ name: "Ada", email: "a@b.co", useCase: "x".repeat(501) }).success).toBe(false);
  });
});

describe("rate limit", () => {
  it("allows 4 attempts per IP per hour and blocks the 6th", () => {
    expect(rateLimit(4, 0)).toEqual({ ok: true });
    expect(rateLimit(5, 0)).toEqual({ ok: false, reason: "ip" });
  });
  it("blocks the 4th attempt for one email in a day", () => {
    expect(rateLimit(0, 2)).toEqual({ ok: true });
    expect(rateLimit(0, 3)).toEqual({ ok: false, reason: "email" });
  });
});

describe("idempotency", () => {
  it("is the same for the same template, recipient and state, whatever the case", () => {
    expect(idemKey("waitlist-receipt", "A@b.co", "r1", "joined")).toBe(idemKey("waitlist-receipt", "a@b.co", "r1", "joined"));
  });
  it("differs when the row state changes", () => {
    expect(idemKey("waitlist-approved", "a@b.co", "r1", "approved:1")).not.toBe(idemKey("waitlist-approved", "a@b.co", "r1", "approved:2"));
  });
});

describe("daily cap", () => {
  it("starts blocking at 200 sends", () => {
    expect(capReached(199, 200)).toBe(false);
    expect(capReached(200, 200)).toBe(true);
  });
});

describe("send errors and backoff", () => {
  it("waits for the sender while the domain is unverified", () => {
    expect(classifySendError({ code: "domain_not_verified" }, 1)).toEqual({ status: "waiting_sender", retry: true });
  });
  it("never retries a suppressed recipient", () => {
    expect(classifySendError({ code: "recipient_suppressed" }, 1)).toEqual({ status: "suppressed", retry: false });
  });
  it("stops retrying after the attempt limit", () => {
    expect(classifySendError({ status: 500 }, MAX_ATTEMPTS)).toEqual({ status: "failed", retry: false });
  });
  it("backs off 5 then 10 minutes and caps at 6 hours", () => {
    expect(backoffMs(1)).toBe(300_000);
    expect(backoffMs(2)).toBe(600_000);
    expect(backoffMs(20)).toBe(21_600_000);
  });
});
