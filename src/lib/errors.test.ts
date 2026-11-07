import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("never passes server internals through", () => {
    expect(
      friendlyError(
        new Error("Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY"),
      ),
    ).toMatch(/configured/);
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/reach the data service/);
    expect(friendlyError(new Error("HTTP 404"))).toMatch(/published/);
    expect(friendlyError(new Error("weird"))).toBe("Something went wrong while loading this.");
  });
});
