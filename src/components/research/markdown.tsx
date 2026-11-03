import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { cn } from "@/lib/utils";

/** Markdown with filing:TICKER:ACCESSION[:DOC] links (optional "quoted phrase" title) that open the source panel. */
export function ResearchMarkdown({ children, className }: { children: string; className?: string }) {
  const { open } = useSource();
  return (
    <div className={cn("prose-filing", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("filing:") ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, title, children: label }) => {
            if (href?.startsWith("filing:")) {
              const [, ticker, accn, ...doc] = href.split(":");
              return (
                <button
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
                  className="inline-flex items-baseline gap-0.5 rounded bg-highlight-soft px-1 text-[0.85em] font-medium text-highlight-foreground no-underline hover:bg-highlight"
                >
                  <FileText className="size-3 self-center" />
                  {label}
                </button>
              );
            }
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
