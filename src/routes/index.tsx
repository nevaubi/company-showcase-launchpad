import { createFileRoute } from "@tanstack/react-router";
import "@/components/fu-landing/components/arc/foundation.css";
import { LandingVerification } from "@/components/fu-landing/landing/landing-pages";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Filed Under — research where every number is sourced" },
      { name: "description", content: "AI research for financial markets, built on a fully backfilled filing history where every figure is reconciled and cited to its source." },
      { property: "og:title", content: "Filed Under — research where every number is sourced" },
      { property: "og:description", content: "Every figure backfilled, reconciled and cited before it reaches you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: "https://filedunder.ai/" },
      { name: "google-site-verification", content: "uuQECA0Aaj4rMohTzfjiXySNB61j9pJ6YGCv8gdR43k" },
    ],
    links: [{ rel: "canonical", href: "https://filedunder.ai/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Filed Under",
          url: "https://filedunder.ai/",
          logo: "https://filedunder.ai/favicon.png",
          description: "US equity research where every number links to its SEC source.",
        }),
      },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <div className="fu-landing" data-theme="light">
      <LandingVerification />
    </div>
  );
}
