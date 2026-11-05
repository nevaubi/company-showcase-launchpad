import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { cn } from "@/lib/utils";
import { AnswerChart, parseChartSpec } from "@/components/research/answer-chart";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

/** Markdown with filing:TICKER:ACCESSION[:DOC] links (optional "quoted phrase" title) that open the source panel. */
export function ResearchMarkdown({ children, className }: { children: string; className?: string }) {
  const { open } = useSource();
  return (
    <div className={cn("prose-filing", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("filing:") ? url : defaultUrlTransform(url))}
        components={{
          pre: ({ children: c, node }) => {
            const code = node?.children?.[0] as { properties?: { className?: string[] }; children?: { value?: string }[] } | undefined;
            if (code?.properties?.className?.includes("language-chart")) {
              const spec = parseChartSpec(code.children?.map((t) => t.value ?? "").join("") ?? "");
              if (spec) return <AnswerChart spec={spec} />;
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
