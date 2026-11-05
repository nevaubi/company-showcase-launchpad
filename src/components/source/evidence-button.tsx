import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSource } from "./source-context";

export function EvidenceButton({ ticker, title, url, quote, date, confidence }: {
  ticker: string; title: string; url: string; quote?: string; date?: string; confidence?: string;
}) {
  const { open } = useSource();
  return <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" aria-label={`View evidence: ${title}`} title="View source details" onClick={() => open({
    ticker, label: title, unit: "usd", value: 0, external: { url, quote, date, confidence },
  })}><FileText className="size-3" /> Source</Button>;
}