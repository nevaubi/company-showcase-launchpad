const assets = import.meta.glob("../media/**/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export const mediaUrls: Record<string, string> = {};
for (const [key, url] of Object.entries(assets)) {
  mediaUrls[key.replace("../media", "/media")] = url;
}

export function resolveMedia(src: string): string {
  return mediaUrls[src] ?? src;
}
