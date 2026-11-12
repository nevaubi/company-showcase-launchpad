import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { cn } from "@/lib/utils";
import { AnswerChart, parseChartSpec } from "@/components/research/answer-chart";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

/**
 * Markdown with filing:TICKER:ACCESSION[:DOC] links (optional "quoted phrase" title) that open the source panel,
 * and pin:N links that show walkthrough stop N on the page (plain text when no onPin handler is given).
 */
export function ResearchMarkdown({ children, className, onPin }: { children: string; className?: string; onPin?: (n: number) => void }) {
  const { open } = useSource();
  return (
    <div className={cn("prose-filing", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("filing:") || /^pin:\d+$/.test(url) ? url : defaultUrlTransform(url))}
        components={{
          pre: ({ children: c, node }) => {
            const code = node?.children?.[0] as { properties?: { className?: string[] }; children?: { value?: string }[] } | undefined;
            const cls = code?.properties?.className ?? [];
            if (cls.includes("language-chart")) {
              const spec = parseChartSpec(code?.children?.map((t) => t.value ?? "").join("") ?? "");
              if (spec) return <AnswerChart spec={spec} />;
            }
            // Leaked data and unrequested code (see lib/research/sanitize.ts) stay collapsed.
            if (cls.includes("language-data") || cls.includes("language-hidden-code")) {
              return (
                <details className="not-prose my-2 rounded-md border bg-muted/30 text-[11.5px]">
                  <summary className="cursor-pointer select-none px-2 py-1 text-muted-foreground">{cls.includes("language-data") ? "Data" : "Code"}</summary>
                  <pre className="max-h-64 overflow-auto border-t p-2 font-mono text-[10.5px] leading-relaxed scrollbar-thin">{c}</pre>
                </details>
              );
            }
            return <pre>{c}</pre>;
          },
          a: ({ href, title, children: label }) => {
            if (href?.startsWith("filing:")) {
              const [, ticker, accn, ...doc] = href.split(":");
              return (
                <Button variant="ghost"
                  type="button"
                  onClick={() =>
                    open({
                      ticker: ticker.toUpperCase(),
                      label: String(Array.isArray(label) ? label.join("") : label),
                      unit: "usd",
                      value: 0,
                      doc: { accn, doc: doc.join(":"), title: `${ticker.toUpperCase()} · ${accn}`, search: title || undefined },
                    })
                  }
                  title={title ? `“${title}”` : undefined}
                  className="inline-flex h-auto items-baseline gap-0.5 rounded bg-highlight-soft px-1 py-0 text-[0.85em] font-medium text-highlight-foreground no-underline hover:bg-highlight"
                >
                  <FileText className="size-3 self-center" />
                  {label}
                </Button>
              );
            }
            if (href?.startsWith("pin:")) {
              const n = Number(href.slice(4));
              if (!onPin || !Number.isInteger(n)) return <>{label}</>;
              return (
                <button
                  type="button"
                  onClick={() => onPin(n)}
                  title={`Show stop ${n} on the page`}
                  className="inline cursor-pointer rounded-sm border-b border-dashed border-foreground/40 text-left font-medium transition-colors hover:bg-highlight-soft"
                >
                  {label}
                  <span className="agent-pin-ref">{n}</span>
                </button>
              );
            }
            if (href?.startsWith("/app/")) return <Link to={href}>{label}</Link>;
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
