import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeOfficialResponseBody } from "./official-response-body";

const nativeOpen = fs.open;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const payload = Buffer.from('CERT,REPDTE,VALUE,NOTE\r\n00123,20260930,0,""\r\n');
let openSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => { openSpy?.mockRestore(); openSpy = undefined; });

async function delayedResponse(signal: AbortSignal, complete = true) {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
    data(socket) {
      socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/csv\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`);
      socket.flush();
      if (complete) setTimeout(() => { socket.write(payload); socket.flush(); socket.end(); }, 10);
      else { socket.write(payload.subarray(0, 8)); socket.flush(); }
    },
  } });
  try {
    const response = await fetch(`http://127.0.0.1:${listener.port}/`, { signal });
    return { response, close: () => listener.stop(true) };
  } catch (error) { listener.stop(true); throw error; }
}

test("retains exact bytes when the native HTTP body finishes during file open", async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), "official-body-"));
  const filePath = join(folder, "response.csv");
  const signal = AbortSignal.timeout(2000);
  const { response, close } = await delayedResponse(signal);
  const body = response.body!;
  // Real disk open and native HTTP stream; only disk latency is controlled.
  openSpy = spyOn(fs, "open").mockImplementation(async (...args) => {
    await pause(40);
    return nativeOpen(...args);
  });
  try {
    await expect(writeOfficialResponseBody(body, filePath, signal, 1024)).resolves.toBe(payload.length);
    expect(await fs.readFile(filePath)).toEqual(payload);
    expect(body.locked).toBe(false);
  } finally { close(); await fs.rm(folder, { recursive: true, force: true }); }
});

test("cancels and unlocks the response when opening the output file fails", async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), "official-body-"));
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  try {
    await expect(writeOfficialResponseBody(body, join(folder, "absent", "response.csv"), new AbortController().signal, 1024)).rejects.toMatchObject({ code: "ENOENT" });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test("retains the original file-open error when response cancellation also fails", async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), "official-body-"));
  const body = new ReadableStream<Uint8Array>({ cancel() { throw new Error("Cancellation failed"); } });
  try {
    await expect(writeOfficialResponseBody(body, join(folder, "absent", "response.csv"), new AbortController().signal, 1024)).rejects.toMatchObject({ code: "ENOENT" });
    expect(body.locked).toBe(false);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test("propagates a body timeout and closes the output file", async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), "official-body-"));
  const signal = AbortSignal.timeout(100);
  const { response, close } = await delayedResponse(signal, false);
  const body = response.body!;
  let handle: Awaited<ReturnType<typeof nativeOpen>> | undefined;
  openSpy = spyOn(fs, "open").mockImplementation(async (...args) => handle = await nativeOpen(...args));
  try {
    await expect(writeOfficialResponseBody(body, join(folder, "response.csv"), signal, 1024)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(body.locked).toBe(false);
    await expect(handle!.stat()).rejects.toMatchObject({ code: "EBADF" });
  } finally { close(); await fs.rm(folder, { recursive: true, force: true }); }
});

test("enforces the byte limit before writing an oversized chunk and closes the file", async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), "official-body-"));
  const filePath = join(folder, "response.csv");
  let handle: Awaited<ReturnType<typeof nativeOpen>> | undefined;
  let cancelled = false;
  openSpy = spyOn(fs, "open").mockImplementation(async (...args) => handle = await nativeOpen(...args));
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(Buffer.from("123456")); controller.enqueue(Buffer.from("789012")); },
    cancel() { cancelled = true; },
  });
  try {
    await expect(writeOfficialResponseBody(body, filePath, new AbortController().signal, 8)).rejects.toThrow("bounded refresh payload size");
    expect(await fs.readFile(filePath, "utf8")).toBe("123456");
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
    await expect(handle!.stat()).rejects.toMatchObject({ code: "EBADF" });
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test("does not suppress a file-close error and still releases the reader", async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), "official-body-"));
  const failure = new Error("Output file close failed");
  openSpy = spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await nativeOpen(...args);
    const close = handle.close.bind(handle);
    handle.close = async () => { await close(); throw failure; };
    return handle;
  });
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(payload); controller.close(); } });
  try {
    await expect(writeOfficialResponseBody(body, join(folder, "response.csv"), new AbortController().signal, 1024)).rejects.toBe(failure);
    expect(body.locked).toBe(false);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
