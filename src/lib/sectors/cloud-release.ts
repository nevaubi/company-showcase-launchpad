import { supabase } from "@/integrations/supabase/client";

const paths = new Set(["sectors.json", "sectors/banks.json", "sectors/banks.comp.json", "sectors/financials.json", "sectors/financials.comp.json"]);

export async function sectorFile<T>(path: string, fallback: (p: string) => Promise<T>): Promise<T> {
  if (!paths.has(path)) return fallback(path);
  const read = supabase.rpc.bind(supabase) as unknown as (fn: string, args: { _path: string }) => Promise<{
    data: { body: string; sha256: string; as_of: string; period: string } | null;
    error: { message: string } | null;
  }>;
  const { data, error } = await read("sector_dataset_release_v1", { _path: path });
  if (error) throw new Error("The verified sector release could not be loaded.");
  if (!data) return fallback(path);
  const compressed = Uint8Array.from(atob(data.body), (x) => x.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", compressed));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== data.sha256) throw new Error("The sector release did not match its published checksum.");
  const body = new Response(compressed).body!.pipeThrough(new DecompressionStream("gzip"));
  const file = await new Response(body).json();
  return { ...file, sector_release: { as_of: data.as_of, period: data.period } } as T;
}
