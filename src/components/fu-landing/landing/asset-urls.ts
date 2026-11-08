const pointers = import.meta.glob("../../../assets/fu-landing/*.asset.json", { eager: true, import: "default" }) as Record<string, { url: string }>;
const byName: Record<string, string> = {};
for (const [k, v] of Object.entries(pointers)) byName[k.split("/").pop()!.replace(/\.asset\.json$/, "")] = v.url;
/** Resolves a file name from the original zip (e.g. "chicago-river-dusk.mp4") to its hosted URL. */
export const assetUrl = (name: string) => byName[name] ?? name;
