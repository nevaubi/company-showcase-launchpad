import { useLayoutEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useFeatureGate } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ReportBrand } from "./report-document";
import type { ReportContent } from "@/lib/reports/types";
import { downloadBlob } from "@/lib/export/xlsx-theme";

export function DownloadMenu({ content, brand }: { content: ReportContent | null; brand: ReportBrand }) {
  const [building, setBuilding] = useState(false);
  const active = useRef<AbortController | null>(null);
  const { branding, logo, firmName, preparedBy } = brand;
  useLayoutEffect(() => {
    setBuilding(false);
    return () => { active.current?.abort(); active.current = null; };
  }, [content, branding, logo, firmName, preparedBy]);

  const file = content ? `${content.ticker}-${content.kind}-${content.asOf}` : "report";
  const gate = useFeatureGate();
  const downloadWord = async () => {
    if (!content || active.current || !gate("exports")) return;
    const request = new AbortController();
    active.current = request;
    setBuilding(true);
    try {
      const root = document.querySelector(".report-doc");
      const [{ reportToDocx }, { captureCharts }] = await Promise.all([import("@/lib/export/report-docx"), import("@/lib/export/chart-capture")]);
      if (request.signal.aborted) return;
      const images = root ? await captureCharts(root) : new Map();
      if (request.signal.aborted) return;
      const blob = await reportToDocx(content, brand, images);
      if (!request.signal.aborted) downloadBlob(blob, `${file}.docx`);
    } catch (e) {
      if (!request.signal.aborted) toast.error(`Word export failed: ${(e as Error).message}`);
    } finally {
      if (active.current === request) {
        active.current = null;
        setBuilding(false);
      }
    }
  };
  const print = () => {
    if (!gate("exports")) return;
    const root = document.documentElement;
    const done = () => { root.classList.remove("printing-report"); window.removeEventListener("afterprint", done); };
    root.classList.add("printing-report");
    window.addEventListener("afterprint", done);
    const title = document.title;
    document.title = file;
    window.print();
    document.title = title;
    setTimeout(done, 1000);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ink" size="sm" disabled={!content}><Download /> {building ? "Preparing Word…" : "Download"}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={print}>PDF<span className="ml-auto text-[11px] text-muted-foreground">Print → Save as PDF</span></DropdownMenuItem>
        <DropdownMenuItem disabled={building} onClick={downloadWord}>Word (.docx)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
