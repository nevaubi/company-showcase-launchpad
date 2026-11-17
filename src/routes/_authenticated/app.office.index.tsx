import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, FileSpreadsheet, Presentation, FileType2, Loader2, Trash2, Upload } from "lucide-react";
import { ulid } from "ulid";
import { toast } from "sonner";
import { Empty, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { fmtRelative } from "@/lib/format";
import { createOfficeFile, deleteOfficeFile, importOfficeFile, listOfficeFiles, type OfficeKind } from "@/lib/office/files.functions";

export const Route = createFileRoute("/_authenticated/app/office/")({
  head: () => ({
    meta: [
      { title: "Office Studio — Filed Under" },
      { name: "description", content: "Word, Excel, PowerPoint and PDF files with sourced Filed Under data." },
      { property: "og:title", content: "Office Studio — Filed Under" },
      { property: "og:description", content: "Word, Excel, PowerPoint and PDF files with sourced Filed Under data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OfficeHub,
});

const KINDS: { kind: OfficeKind; label: string; icon: typeof FileText; blank: string }[] = [
  { kind: "docx", label: "Writer", icon: FileText, blank: "Untitled document" },
  { kind: "xlsx", label: "Sheets", icon: FileSpreadsheet, blank: "Untitled workbook" },
  { kind: "pptx", label: "Slides", icon: Presentation, blank: "Untitled deck" },
  { kind: "pdf", label: "PDF", icon: FileType2, blank: "Untitled PDF" },
];
const EXT = /\.(docx|xlsx|pptx|pdf)$/i;

function OfficeHub() {
  const qc = useQueryClient();
  const list = useServerFn(listOfficeFiles);
  const create = useServerFn(createOfficeFile);
  const remove = useServerFn(deleteOfficeFile);
  const record = useServerFn(importOfficeFile);
  const navigate = useNavigate();
  const open = (r: { id: string; kind: string }) => {
    if (r.kind === "docx") void navigate({ to: "/app/office/writer/$id", params: { id: r.id } });
    else toast.info("This editor is coming next — Writer is ready now.");
  };
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const files = useQuery({ queryKey: ["office-files"], queryFn: () => list() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["office-files"] });

  const make = useMutation({
    mutationFn: (k: (typeof KINDS)[number]) => create({ data: { kind: k.kind, title: k.blank } }),
    onSuccess: (r, k) => { refresh(); open({ id: r.id, kind: k.kind }); },
    onError: (e) => toast.error((e as Error).message),
  });

  async function upload(list: FileList | File[]) {
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    try {
      for (const f of Array.from(list)) {
        const m = f.name.match(EXT);
        if (!m || !u.user) { toast.error(`${f.name}: only .docx, .xlsx, .pptx or .pdf`); continue; }
        const kind = m[1].toLowerCase() as OfficeKind;
        const id = ulid();
        const { error } = await supabase.storage.from("office-files").upload(`${u.user.id}/${id}.${kind}`, f, { contentType: f.type || undefined });
        if (error) { toast.error(`${f.name}: ${error.message}`); continue; }
        await record({ data: { id, kind, title: f.name.replace(EXT, ""), size: f.size } });
      }
      refresh();
    } finally { setBusy(false); }
  }

  const rows = (files.data ?? []).filter((r) => r.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div
      className="mx-auto w-full max-w-5xl min-w-0 space-y-6 p-4 md:p-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}
      data-section="Office Studio"
    >
      <PageHeader title="Office Studio" description="Create or import Word, Excel, PowerPoint and PDF files. Drop files anywhere on this page." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {KINDS.map((k) => (
          <button key={k.kind} onClick={() => make.mutate(k)} disabled={make.isPending}
            className="flex min-w-0 flex-col items-start gap-2 rounded-md border bg-card p-4 text-left transition-colors hover:bg-accent">
            <k.icon className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">New {k.label}</span>
          </button>
        ))}
        <button onClick={() => input.current?.click()} disabled={busy}
          className="flex min-w-0 flex-col items-start gap-2 rounded-md border border-dashed bg-card p-4 text-left hover:bg-accent">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
          <span className="text-sm font-medium">Import file</span>
        </button>
        <input ref={input} type="file" multiple accept=".docx,.xlsx,.pptx,.pdf" className="hidden"
          onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
      </div>
      <Input placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
      {files.isLoading ? <Skeleton className="h-40" /> : rows.length === 0 ? (
        <Empty title="No files yet">Start a new file above or import one.</Empty>
      ) : (
        <div className="divide-y rounded-md border">
          {rows.map((r) => {
            const K = KINDS.find((k) => k.kind === r.kind)!;
            return (
              <div key={r.id} className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm">
                <K.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <button onClick={() => open(r)} className="min-w-0 flex-1 truncate text-left hover:underline">{r.title}</button>
                <span className="hidden text-xs text-muted-foreground sm:inline">{K.label}</span>
                <span className="text-xs text-muted-foreground">{fmtRelative(r.updated_at)}</span>
                <Button size="icon" variant="ghost" aria-label="Delete file"
                  onClick={async () => { await remove({ data: { id: r.id } }); refresh(); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
