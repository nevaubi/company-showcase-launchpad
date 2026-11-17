import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ulid } from "ulid";
import { requireAppAccess } from "@/lib/app-access-middleware";

const Kind = z.enum(["docx", "xlsx", "pptx", "pdf"]);
export type OfficeKind = z.infer<typeof Kind>;

/** Signed-in user's office files, newest first. */
export const listOfficeFiles = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("office_files").select("id, kind, title, size_bytes, version, updated_at")
      .eq("owner", context.userId).order("updated_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** New empty file record (ids are ULIDs, which the engine requires). */
export const createOfficeFile = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((i: unknown) => z.object({ kind: Kind, title: z.string().trim().min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const id = ulid();
    const { error } = await context.supabase.from("office_files")
      .insert({ id, owner: context.userId, kind: data.kind, title: data.title });
    if (error) throw new Error(error.message);
    return { id };
  });

export const renameOfficeFile = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((i: unknown) => z.object({ id: z.string().length(26), title: z.string().trim().min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("office_files")
      .update({ title: data.title, updated_at: new Date().toISOString() }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteOfficeFile = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((i: unknown) => z.object({ id: z.string().length(26) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("office_files").select("storage_path").eq("id", data.id).maybeSingle();
    if (row?.storage_path) await context.supabase.storage.from("office-files").remove([row.storage_path]);
    const { error } = await context.supabase.from("office_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Short-lived engine token for one file the caller owns. */
export const getEngineToken = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((i: unknown) => z.object({ id: z.string().length(26) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("office_files").select("id").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("File not found");
    const email = (context.claims as { email?: string }).email ?? "Filed Under user";
    const { mintEngineToken } = await import("@/lib/office/engine-token.server");
    return mintEngineToken(context.userId, email, data.id);
  });

/** Record an uploaded file (bytes already in `office-files/<uid>/<id>.<ext>`). */
export const importOfficeFile = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((i: unknown) => z.object({ id: z.string().length(26), kind: Kind, title: z.string().trim().min(1).max(200), size: z.number().int().min(0) }).parse(i))
  .handler(async ({ data, context }) => {
    const path = `${context.userId}/${data.id}.${data.kind}`;
    const { error } = await context.supabase.from("office_files")
      .insert({ id: data.id, owner: context.userId, kind: data.kind, title: data.title, storage_path: path, size_bytes: data.size });
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

export const getOfficeFile = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
  .inputValidator((i: unknown) => z.object({ id: z.string().length(26) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("office_files")
      .select("id, kind, title, storage_path, version, updated_at").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("File not found");
    return { ...row, owner: context.userId };
  });

/** Mark a save after the browser uploaded the new bytes. */
export const markOfficeSaved = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((i: unknown) => z.object({ id: z.string().length(26), size: z.number().int().min(0), title: z.string().trim().min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("office_files").select("kind, version").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("File not found");
    const { error } = await context.supabase.from("office_files").update({
      storage_path: `${context.userId}/${data.id}.${row.kind}`, size_bytes: data.size, title: data.title,
      version: row.version + 1, updated_at: new Date().toISOString(),
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { version: row.version + 1 };
  });
