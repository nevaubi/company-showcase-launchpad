/**
 * Run only inside the app/worker environment. The service key never leaves that environment.
 *   bun scripts/source-upload-manifest.ts --manifest=/tmp/upload-manifest.json
 * Validates every content-addressed path, signs uploads without overwrite permission, stores the
 * tickets privately, and prints one short-lived read URL instead of thousands of upload tokens.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { validateSourceFile } from "../src/lib/sources/validation";
import type { SourceChunk } from "../src/lib/sources/schema";

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [key, ...value] = a.replace(/^--/, "").split("="); return [key, value.join("=")]; }));
if (!args.manifest) throw new Error("--manifest=<local JSON file> is required");
const manifest = JSON.parse(await readFile(args.manifest, "utf8")) as { version: number; files: unknown[] };
if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Expected source manifest version 1 with files");
const chunks = new Map<string, SourceChunk>();
for (const raw of manifest.files) for (const chunk of validateSourceFile(raw).chunks) {
  const known = chunks.get(chunk.path);
  if (known && known.bytes !== chunk.bytes) throw new Error("One chunk hash was declared with different lengths");
  chunks.set(chunk.path, chunk);
}
const { sb, dbGate } = await import("./lib/supa");
const uploads: { path: string; sha256: string; bytes: number; token: string; signedUrl: string }[] = [];
const queue = [...chunks.values()];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const chunk = queue[next++];
    if (!chunk) return;
    await dbGate("source-upload-signing");
    const { data, error } = await sb.storage.from("datasets").createSignedUploadUrl(chunk.path, { upsert: false });
    if (error || !data) throw new Error(`Could not sign ${chunk.path}: ${error?.message ?? "empty response"}`);
    uploads.push({ path: chunk.path, sha256: chunk.sha256, bytes: chunk.bytes, token: data.token, signedUrl: data.signedUrl });
  }
}));
uploads.sort((a, b) => a.path.localeCompare(b.path));
const ticketObject = `${randomUUID()}.json`;
const now = new Date();
const payload = JSON.stringify({ version: 1, created_at: now.toISOString(), expires_at: new Date(now.getTime() + 2 * 3600_000).toISOString(), uploads });
const saved = await sb.storage.from("official-ingest-tickets").upload(ticketObject, payload, { contentType: "application/json", upsert: false });
if (saved.error) throw new Error(`Could not save upload tickets: ${saved.error.message}`);
const signed = await sb.storage.from("official-ingest-tickets").createSignedUrl(ticketObject, 1800);
if (signed.error || !signed.data) throw new Error(`Could not sign tickets read: ${signed.error?.message}`);
console.log(JSON.stringify({ ticket_bucket: "official-ingest-tickets", ticket_object: ticketObject, ticket_url: signed.data.signedUrl, read_expires_seconds: 1800, upload_expires_seconds: 7200, chunks: uploads.length, bytes: uploads.reduce((n, x) => n + x.bytes, 0) }));
