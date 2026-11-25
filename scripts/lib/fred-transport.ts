/**
 * FRED-only transport for the observed Bun connection reset. Python uses urllib
 * with normal verified TLS/proxy configuration; the existing stager still owns
 * native parsing, immutable hashes and publication.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rm, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout, clearTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { authoritativeCsvUrl, safeRefreshRedirect } from "../../src/lib/sources/refresh-plan";
import type { SourceJson } from "../../src/lib/sources/schema";

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_STDOUT = 32 * 1024;
const MAX_STDERR = 8 * 1024;
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "fred-download.py");
const header = z.string().max(2048).regex(/^[\x20-\x7e]*$/);
const common = {
  version: z.literal(1), ok: z.literal(true), url: z.string().min(1).max(8192),
  resolved_url: z.string().min(1).max(8192), etag: header.optional(), last_modified: header.optional(),
  python_version: z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/),
};
const receiptSchema = z.union([
  z.object({ ...common, status: z.literal(200), bytes: z.number().int().min(0).max(MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), retrieved_at: z.string().datetime({ offset: true }),
    content_type: header, content_length: z.number().int().min(0).max(MAX_BYTES).nullable(),
    content_encoding: z.literal("identity") }).strict(),
  z.object({ ...common, status: z.literal(304) }).strict(),
  z.object({ version: z.literal(1), ok: z.literal(false), error: z.object({
    code: z.string().regex(/^[a-z_]{1,64}$/), message: z.string().max(512).regex(/^[\x20-\x7e]*$/),
  }).strict() }).strict(),
]);

export type FredDownloadInput = {
  url: string; filePath: string; userAgent: string; signal: AbortSignal; deadline: number;
  etag?: string; lastModified?: string;
};
type FredTransportEvidence = Record<string, SourceJson>;
export type FredDownloadResult =
  | { notModified: true; url: string; etag?: string; lastModified?: string; transport: FredTransportEvidence }
  | { notModified: false; filePath: string; bytes: number; url: string; resolvedUrl: string;
      retrievedAt: string; contentType: string; etag?: string; lastModified?: string; transport: FredTransportEvidence };

function stopped(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "FRED download stopped"));
}
function check(signal: AbortSignal) { if (signal.aborted) throw stopped(signal); }

/** Pass only process discovery, ordinary network proxy and verified CA settings. */
function pythonEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function runPython(request: string, descriptor: number, signal: AbortSignal): Promise<{ stdout: string; code: number | null }> {
  check(signal);
  return await new Promise((resolve, reject) => {
    const child = spawn("python3", ["-I", SCRIPT], {
      env: pythonEnvironment(), stdio: ["pipe", "pipe", "pipe", descriptor],
    });
    let stdout = "", stdoutBytes = 0, stderrBytes = 0;
    let failure: Error | undefined, finished = false, killTimer: ReturnType<typeof setTimeout> | undefined;
    const stopChild = (error: Error) => {
      if (finished || failure) return;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => { if (!finished) child.kill("SIGKILL"); }, 1000);
      killTimer.unref();
    };
    const aborted = () => stopChild(stopped(signal));
    const cleanup = () => {
      finished = true;
      signal.removeEventListener("abort", aborted);
      if (killTimer) clearTimeout(killTimer);
    };
    child.once("error", error => {
      const safe = new Error("Could not run the FRED Python transport", { cause: error });
      if (!child.pid) { cleanup(); reject(safe); }
      else stopChild(safe);
    });
    child.stdout!.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT) { stopChild(new Error("FRED Python output exceeded its bounded limit")); return; }
      stdout += chunk.toString("utf8");
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR) stopChild(new Error("FRED Python diagnostic output exceeded its bounded limit"));
    });
    child.once("close", code => {
      cleanup();
      if (failure) reject(failure);
      else if (signal.aborted) reject(stopped(signal));
      else resolve({ stdout, code });
    });
    child.stdin!.on("error", () => { /* Exit status and bounded response are handled on close. */ });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else child.stdin!.end(request);
  });
}

async function fileDigest(path: string, signal: AbortSignal): Promise<{ bytes: number; sha256: string }> {
  check(signal);
  const stream = createReadStream(path);
  const aborted = () => stream.destroy(stopped(signal));
  signal.addEventListener("abort", aborted, { once: true });
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    check(signal);
    for await (const chunk of stream) {
      check(signal);
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw new Error("FRED output file exceeds the maximum size");
      hash.update(chunk);
    }
    check(signal);
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    signal.removeEventListener("abort", aborted);
    stream.destroy();
  }
}

export async function downloadFred(input: FredDownloadInput): Promise<FredDownloadResult> {
  check(input.signal);
  const trusted = authoritativeCsvUrl(input.url);
  if (trusted?.family !== "fred" || input.url.length > 8192) throw new Error("FRED transport requires the reviewed official endpoint");
  const timeoutMs = Math.floor(Math.min(120_000, input.deadline - Date.now()));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("FRED download deadline exceeded");
  if (!header.safeParse(input.userAgent).success || !input.userAgent.trim()) throw new Error("Invalid FRED User-Agent");
  for (const value of [input.etag, input.lastModified]) {
    if (value !== undefined && !header.safeParse(value).success) throw new Error("Invalid FRED conditional validator");
  }
  const request = JSON.stringify({ version: 1, url: input.url, user_agent: input.userAgent,
    ...(input.etag ? { etag: input.etag } : input.lastModified ? { last_modified: input.lastModified } : {}),
    timeout_ms: timeoutMs, max_bytes: MAX_BYTES });
  if (Buffer.byteLength(request) > 16 * 1024) throw new Error("FRED request exceeds the bounded input size");

  const operation = new AbortController();
  const forwardAbort = () => operation.abort(stopped(input.signal));
  input.signal.addEventListener("abort", forwardAbort, { once: true });
  if (input.signal.aborted) forwardAbort();
  const timer = setTimeout(() => operation.abort(new Error("FRED download deadline exceeded")), timeoutMs);
  timer.unref();
  let handle: FileHandle | undefined, keep = false;
  try {
    check(operation.signal);
    // Ownership is established before spawning; cleanup can only remove our file.
    handle = await open(input.filePath, "wx", 0o600);
    check(operation.signal);
    const completed = await runPython(request, handle.fd, operation.signal);
    let raw: unknown;
    try { raw = JSON.parse(completed.stdout); }
    catch { throw new Error("FRED Python transport returned an invalid bounded receipt"); }
    const parsed = receiptSchema.safeParse(raw);
    if (!parsed.success) throw new Error("FRED Python transport returned an invalid bounded receipt");
    const receipt = parsed.data;
    if (!receipt.ok) throw new Error("FRED request failed (" + receipt.error.code + "): " + receipt.error.message);
    if (completed.code !== 0) throw new Error("FRED Python transport exited without a successful receipt");
    if (receipt.url !== input.url || !safeRefreshRedirect(input.url, receipt.resolved_url)) {
      throw new Error("FRED response changed the reviewed endpoint or series identity");
    }
    check(operation.signal);
    const transport: FredTransportEvidence = { name: "python_urllib", version: 1,
      python_version: receipt.python_version, http_status: receipt.status,
      tls_verification: "stdlib_default_context", accept_encoding: "identity" };
    if (receipt.status === 304) {
      if (!input.etag && !input.lastModified) throw new Error("FRED returned 304 without a conditional validator");
      if ((await handle.stat()).size !== 0) throw new Error("FRED 304 unexpectedly returned file bytes");
      return { notModified: true, url: input.url, etag: receipt.etag ?? input.etag,
        lastModified: receipt.last_modified ?? input.lastModified, transport };
    }
    if (/html|json|xml/i.test(receipt.content_type)) throw new Error("FRED returned a non-CSV content type");
    const size = (await handle.stat()).size;
    if (size !== receipt.bytes || (receipt.content_length !== null && size !== receipt.content_length)) {
      throw new Error("FRED output file size differs from the complete response length");
    }
    const verified = await fileDigest(input.filePath, operation.signal);
    if (verified.bytes !== receipt.bytes || verified.sha256 !== receipt.sha256) {
      throw new Error("FRED output file hash differs from the complete response hash");
    }
    check(operation.signal);
    keep = true;
    return { notModified: false, filePath: input.filePath, bytes: receipt.bytes, url: input.url,
      resolvedUrl: receipt.resolved_url, retrievedAt: receipt.retrieved_at, contentType: receipt.content_type,
      etag: receipt.etag, lastModified: receipt.last_modified,
      transport: { ...transport, content_encoding: receipt.content_encoding,
        declared_content_length: receipt.content_length, received_bytes: receipt.bytes,
        received_sha256: receipt.sha256, body_sha256_verified: true, complete_response: true } };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", forwardAbort);
    try { await handle?.close(); }
    catch (error) { keep = false; throw error; }
    finally { if (handle && !keep) await rm(input.filePath, { force: true }); }
  }
}


