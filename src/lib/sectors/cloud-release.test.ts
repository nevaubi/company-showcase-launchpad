import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { sectorFile } from "./cloud-release";

describe("native sector release", () => {
  it("reads a verified native bundle when the upstream is unavailable", async () => {
    const gz = gzipSync(JSON.stringify({ members: ["ABC"], n: 116 }));
    rpc.mockResolvedValue({ data: { as_of: "2026-11-27", period: "2026Q3", body: gz.toString("base64"), sha256: createHash("sha256").update(gz).digest("hex") }, error: null });
    const offline = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await sectorFile("sectors/banks.json", offline)).toEqual({ members: ["ABC"], n: 116, sector_release: { as_of: "2026-11-27", period: "2026Q3" } });
    expect(offline).not.toHaveBeenCalled();
  });
  it("rejects invalid bytes and routes other groups normally", async () => {
    rpc.mockResolvedValue({ data: { body: "eA==", sha256: "invalid" }, error: null });
    const fallback = vi.fn().mockResolvedValue("Utilities");
    await expect(sectorFile("sectors/banks.json", fallback)).rejects.toThrow("checksum");
    expect(await sectorFile("sectors/utilities.json", fallback)).toBe("Utilities");
  });
});
