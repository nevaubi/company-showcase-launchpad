import type { ReactNode } from "react";

/** Site marks drawn from the official brand glyphs (Simple Icons geometry). Mono marks use currentColor so they stay crisp in light and dark; Stripe and Stack Overflow keep their brand fills. */
export type SourceCardsMarkId = "github" | "mdn" | "stripe" | "vercel" | "wikipedia" | "stackoverflow";

const paths: Record<SourceCardsMarkId, { d: string; fill?: string }> = {
  github: { d: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" },
  mdn: { d: "m21.538 1.1-6.745 21.8h-2.77L18.77 1.1ZM24 1.1v21.8h-2.462V1.1Zm-12 0v21.8H9.538V1.1Zm-2.462 0L2.77 22.9H0L6.746 1.1Z" },
  stripe: { fill: "#635BFF", d: "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" },
  vercel: { d: "m12 1.608 12 20.784H0Z" },
  wikipedia: { d: "M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.436 0 .135.053.33.166.601 1.082 2.646 4.818 10.521 4.818 10.521l.136.046 2.411-4.81-.482-1.067-1.658-3.264s-.318-.654-.428-.872c-.728-1.443-.712-1.518-1.447-1.617-.207-.023-.313-.05-.313-.149v-.468l.06-.045h4.292l.113.037v.451c0 .105-.076.15-.227.15l-.308.047c-.792.061-.661.381-.136 1.422l1.582 3.252 1.758-3.504c.293-.64.233-.801.111-.947-.07-.084-.305-.22-.812-.24l-.201-.021c-.052 0-.098-.015-.145-.051-.045-.031-.067-.076-.067-.129v-.427l.061-.045c1.247-.008 4.043 0 4.043 0l.059.045v.436c0 .121-.059.178-.193.178-.646.03-.782.095-1.023.439-.12.186-.375.589-.646 1.039l-2.301 4.273-.065.135 2.792 5.712.17.048 4.396-10.438c.154-.422.129-.722-.064-.895-.197-.172-.346-.273-.857-.295l-.42-.016c-.061 0-.105-.014-.152-.045-.043-.029-.072-.075-.072-.119v-.436l.059-.045h4.961l.041.045v.437c0 .119-.074.18-.209.18-.648.03-1.127.18-1.443.421-.314.255-.557.616-.736 1.067 0 0-4.043 9.258-5.426 12.339-.525 1.007-1.053.917-1.503-.031-.571-1.171-1.773-3.786-2.646-5.71l.053-.036z" },
  stackoverflow: { fill: "#F58025", d: "M15.725 0l-1.72 1.277 6.39 8.588 1.716-1.277L15.725 0zm-3.94 3.418l-1.369 1.644 8.225 6.85 1.369-1.644-8.225-6.85zm-3.15 4.465l-.905 1.94 9.702 4.517.904-1.94-9.701-4.517zm-1.85 4.86l-.44 2.093 10.473 2.201.44-2.092-10.473-2.203zM1.89 15.47V24h19.19v-8.53h-2.133v6.397H4.021v-6.396H1.89zm4.265 2.133v2.13h10.66v-2.13H6.154Z" },
};

/** The readable site name for each mark, used when a source does not pass its own `site`. */
export const sourceSiteNames: Record<SourceCardsMarkId, string> = {
  github: "GitHub",
  mdn: "MDN Web Docs",
  stripe: "Stripe Docs",
  vercel: "Vercel",
  wikipedia: "Wikipedia",
  stackoverflow: "Stack Overflow",
};

const hostRules: [RegExp, SourceCardsMarkId][] = [
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)developer\.mozilla\.org$/, "mdn"],
  [/(^|\.)stripe\.com$/, "stripe"],
  [/(^|\.)vercel\.com$/, "vercel"],
  [/(^|\.)wikipedia\.org$/, "wikipedia"],
  [/(^|\.)stackoverflow\.com$/, "stackoverflow"],
];

/** "https://www.docs.stripe.com/x" -> "docs.stripe.com". Falls back to the raw string for anything that is not a URL. */
export function sourceHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.replace(/^https?:\/\//, "").split("/")[0] ?? url; }
}

/** Picks a known mark from the URL's host, so most sources need no `mark` prop at all. */
export function markForUrl(url: string): SourceCardsMarkId | undefined {
  const host = sourceHost(url);
  return hostRules.find(([rule]) => rule.test(host))?.[1];
}

/** A known mark, a custom icon, or the host's first letter on a quiet disc when the site is unknown. */
export function SourceMark({ mark, icon, host, size = 14 }: { mark?: SourceCardsMarkId; icon?: ReactNode; host: string; size?: number }) {
  if (icon) return <span aria-hidden="true" style={{ display: "inline-grid", width: size, height: size, placeItems: "center", flex: "none" }}>{icon}</span>;
  if (!mark) {
    return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none", display: "block" }}>
      <circle cx="8" cy="8" r="8" fill="currentColor" opacity=".14" />
      <text x="8" y="11.4" textAnchor="middle" fontSize="9.5" fontWeight="500" fill="currentColor" fontFamily="inherit">{(host[0] ?? "?").toUpperCase()}</text>
    </svg>;
  }
  const { d, fill } = paths[mark];
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none", display: "block" }}>
    <path d={d} fill={fill ?? "currentColor"} />
  </svg>;
}
