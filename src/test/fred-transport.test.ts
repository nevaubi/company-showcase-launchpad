import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FredDownloadInput } from "../../scripts/lib/fred-transport";

let downloadFred: typeof import("../../scripts/lib/fred-transport").downloadFred;
const realSpawn = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn;
const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CCSA&cosd=2000-01-01&coed=2026-11-25";
const native = "date,CCSA,note\n2026-11-07,0,\n2026-11-14,001,12345678901234567890.001\n";
let folder = "", mode = "ok", launched: ChildProcess | undefined, ready: Promise<void>;
const fixture = String.raw`
import sys,os,json,hashlib,time,signal
request=json.load(sys.stdin)
mode=MODE
if any(key in os.environ for key in ("SUPABASE_SERVICE_ROLE_KEY","FRED_TEST_UNRELATED_SECRET")):
 print(json.dumps({"version":1,"ok":False,"error":{"code":"environment_leak","message":"Unexpected unrelated environment"}}))
 sys.exit(1)
if mode=="hang":
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 os.write(3,b"partial")
 sys.stderr.write("ready\n");sys.stderr.flush()
 time.sleep(20)
 sys.exit(1)
if mode=="flood":
 os.write(1,b"x"*65536)
 time.sleep(20)
 sys.exit(1)
body=b"date,CCSA,note\n2026-11-07,0,\n2026-11-14,001,12345678901234567890.001\n"
response={"version":1,"ok":True,"status":200,"url":request["url"],"resolved_url":request["url"],
 "bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),"retrieved_at":"2026-11-25T12:00:00Z",
 "content_type":"application/csv","content_length":len(body),"content_encoding":"identity",
 "etag":'"fixture-v1"',"python_version":sys.version.split()[0]}
if mode=="304":
 response={"version":1,"ok":True,"status":304,"url":request["url"],"resolved_url":request["url"],
  "etag":request.get("etag"),"python_version":sys.version.split()[0]}
else:
 os.write(3,body)
if response.get("etag") is None:response.pop("etag",None)
if mode=="bad-hash":response["sha256"]="0"*64
if mode=="wrong-length":response["bytes"]+=1
if mode=="wrong-url":response["resolved_url"]="https://example.invalid/graph/fredgraph.csv?id=CCSA"
if mode=="failure":
 response={"version":1,"ok":False,"error":{"code":"network_error","message":"Official FRED request failed"}}
print(json.dumps(response,separators=(",",":")))
sys.exit(1 if mode=="failure" else 0)
`;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "fred-process-test-"));
  mode = "ok"; launched = undefined;
  vi.resetModules();
  vi.doMock("node:child_process", () => {
    const launch = (command: string, _args: readonly string[], options: SpawnOptions) => {
      launched = realSpawn(command, ["-I", "-c", fixture.replace("MODE", JSON.stringify(mode))], options);
      ready = new Promise<void>(resolve => launched!.stderr!.once("data", () => resolve()));
      return launched;
    };
    return { spawn: launch, default: { spawn: launch } };
  });
  ({ downloadFred } = await import("../../scripts/lib/fred-transport"));
});
afterEach(async () => {
  launched?.kill("SIGKILL");
  await rm(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const run = (options: Partial<FredDownloadInput> = {}) => downloadFred({
  url, filePath: join(folder, "response.csv"), userAgent: "FiledUnder official-data refresh",
  signal: new AbortController().signal, deadline: Date.now() + 5000, ...options,
});

describe("bounded Python FRED process transport", () => {
  it("retains complete native bytes and verifies the child's receipt without forwarding database secrets", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    vi.stubEnv("FRED_TEST_UNRELATED_SECRET", "test-only-extra");
    const result = await run();
    expect(result).toMatchObject({ notModified: false, bytes: Buffer.byteLength(native), url, resolvedUrl: url,
      transport: { name: "python_urllib", body_sha256_verified: true, content_encoding: "identity" } });
    expect(await readFile(join(folder, "response.csv"), "utf8")).toBe(native);
  });
  it("removes its empty output file after a conditional 304 without staging bytes", async () => {
    mode = "304";
    await expect(run({ etag: '"fixture-v1"' })).resolves.toMatchObject({ notModified: true, etag: '"fixture-v1"' });
    await expect(readFile(join(folder, "response.csv"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects an unsolicited 304", async () => {
    mode = "304";
    await expect(run()).rejects.toThrow(/304|validator/i);
    await expect(readFile(join(folder, "response.csv"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([["bad-hash", /hash/i], ["wrong-length", /length|size/i], ["wrong-url", /identity|endpoint/i], ["failure", /network_error/i]] as const)("rejects and removes a corrupt or failed %s receipt", async (kind, expected) => {
    mode = kind;
    await expect(run()).rejects.toThrow(expected);
    await expect(readFile(join(folder, "response.csv"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves a file that was already present when exclusive creation fails", async () => {
    await writeFile(join(folder, "response.csv"), "preexisting");
    await expect(run()).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(folder, "response.csv"), "utf8")).toBe("preexisting");
  });
  it("refuses an unreviewed endpoint before creating output", async () => {
    await expect(run({ url: "https://example.invalid/fred.csv?id=CCSA" })).rejects.toThrow(/FRED|endpoint/i);
    await expect(readFile(join(folder, "response.csv"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("terminates a signal-resistant child on abort and removes its partial bytes", async () => {
    mode = "hang";
    const stop = new AbortController();
    const pending = run({ signal: stop.signal });
    const rejected = pending.then(() => null, error => error);
    await vi.waitFor(() => expect(launched).toBeDefined());
    await ready;
    stop.abort(new Error("operator stop"));
    expect(await rejected).toMatchObject({ message: "operator stop" });
    expect(launched!.signalCode).toBe("SIGKILL");
    expect(() => process.kill(launched!.pid!, 0)).toThrow();
    await expect(readFile(join(folder, "response.csv"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("enforces a whole-process deadline even when no HTTP response arrives", async () => {
    mode = "hang";
    const started = Date.now();
    await expect(run({ deadline: started + 100 })).rejects.toThrow(/deadline/i);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(() => process.kill(launched!.pid!, 0)).toThrow();
    await expect(readFile(join(folder, "response.csv"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("kills an overlong child output before collecting an unbounded log", async () => {
    mode = "flood";
    await expect(run()).rejects.toThrow(/output|limit/i);
    expect(() => process.kill(launched!.pid!, 0)).toThrow();
    await expect(readFile(join(folder, "response.csv"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

