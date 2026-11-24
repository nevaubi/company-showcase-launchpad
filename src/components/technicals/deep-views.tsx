import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ReadPanel } from "./read-panel";
import { useTechnicals } from "./use-technicals";

const OpenTechnicals = ({ ticker }: { ticker: string }) => (
  <Link to="/app/markets" search={{ symbol: ticker }} className="whitespace-nowrap text-xs text-link hover:underline">
    Chart, evidence and levels
  </Link>
);

function Loaded({ ticker }: { ticker: string }) {
  const t = useTechnicals(ticker);
  return <ReadPanel symbol={ticker} T={t.T} loading={t.historyLoading || t.computing} compact actions={<OpenTechnicals ticker={ticker} />} />;
}

/**
 * The compact technical read a company page embeds: the same sentences as the Technicals page, each opening
 * the figures behind it, with a link to the full page. The daily history (since 2008) is fetched and analysed
 * in a web worker only once the panel is near the screen, so pages that embed it do not pay for it up front.
 */
export function CompanyIndicators({ ticker }: { ticker: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="min-w-0">
      {near ? <Loaded ticker={ticker} /> : <ReadPanel symbol={ticker} T={null} loading compact actions={<OpenTechnicals ticker={ticker} />} />}
    </div>
  );
}
