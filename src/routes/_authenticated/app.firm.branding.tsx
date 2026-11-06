import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { BrandedCover, BRAND_FONT } from "@/components/firm/branded-cover";
import { friendlyError, useFirm, useFirmLogo } from "@/components/firm/firm-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_BRANDING, readableOn, resolveBranding, type FirmBranding } from "@/lib/firm/core";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/app/firm/branding")({
  head: () => ({
    meta: [
      { title: "Branding — Firm workspace — Filed Under" },
      { name: "description", content: "Logo, colors, typeface and disclaimer used on every report your firm exports." },
      { property: "og:title", content: "Branding — Firm workspace — Filed Under" },
      { property: "og:description", content: "Logo, colors, typeface and disclaimer used on every report your firm exports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BrandingPage,
});

const PRESETS: { name: string; primary: string; accent: string }[] = [
  { name: "Ink", primary: "#1d1d1b", accent: "#c9a227" },
  { name: "Navy", primary: "#0b2545", accent: "#13a89e" },
  { name: "Forest", primary: "#1b4332", accent: "#d4a373" },
  { name: "Oxblood", primary: "#5c1a1b", accent: "#c8a165" },
  { name: "Slate", primary: "#334155", accent: "#38bdf8" },
  { name: "Paper", primary: "#f4f1ea", accent: "#9a3412" },
];

/** Downscale an uploaded image to a small PNG data URL (keeps reports light). */
async function toLogoData(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(file.type)) throw new Error("Use a PNG, JPG, WebP, GIF or SVG image");
  if (file.size > 5_000_000) throw new Error("That image is over 5 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 600, h = img.naturalHeight || 200;
    const scale = Math.min(1, 640 / w, 200 / h);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/png");
    if (data.length > 380_000) throw new Error("That logo is too detailed — try a simpler PNG or SVG");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function BrandingPage() {
  const { firm, can } = useFirm();
  const logo = useFirmLogo(firm?.id);
  const qc = useQueryClient();
  const admin = can("admin");
  const [b, setB] = useState<Required<FirmBranding>>(resolveBranding(firm?.branding));
  const [name, setName] = useState(firm?.name ?? "");
  const [logoData, setLogoData] = useState<string | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setB(resolveBranding(firm?.branding)); setName(firm?.name ?? ""); setLogoData(undefined); }, [firm?.id, firm?.branding, firm?.name]);
  const shownLogo = logoData === undefined ? logo.data : logoData;
  const dirty = JSON.stringify(b) !== JSON.stringify(resolveBranding(firm?.branding)) || name.trim() !== firm?.name || logoData !== undefined;

  const save = useMutation({
    mutationFn: async () => {
      const patch: { branding: Json; name: string; updated_at: string; logo_data?: string | null } = {
        branding: b as unknown as Json, name: name.trim(), updated_at: new Date().toISOString(),
      };
      if (logoData !== undefined) patch.logo_data = logoData;
      const { error } = await supabase.from("firms").update(patch).eq("id", firm!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firms"] });
      qc.invalidateQueries({ queryKey: ["firm-logo", firm?.id] });
      setLogoData(undefined);
      toast.success("Branding saved — new reports use it right away");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try { setLogoData(await toLogoData(f)); } catch (e) { toast.error((e as Error).message); }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel title="Report branding" subtitle={admin ? "Applies to every primer, preview, recap and memo your firm exports." : "Only firm admins can change branding."} collapse={false}>
        <fieldset disabled={!admin} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="firm-name-edit">Firm name</label>
            <Input id="firm-name-edit" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Logo</p>
            <div className="flex items-center gap-2">
              <div className="flex h-12 w-40 items-center justify-center border bg-card">
                {shownLogo ? <img src={shownLogo} alt="Firm logo" className="max-h-10 max-w-36 object-contain" /> : <span className="text-[11px] text-muted-foreground">No logo</span>}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Upload logo" />
              <Button size="sm" variant="outline" type="button" onClick={() => fileRef.current?.click()}><ImagePlus /> Upload</Button>
              {shownLogo && <Button size="icon-sm" variant="ghost" type="button" aria-label="Remove logo" onClick={() => setLogoData(null)}><Trash2 /></Button>}
            </div>
            <p className="text-[11px] text-muted-foreground">A transparent PNG or SVG works best; it's resized to fit the report header.</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Colors</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.name} type="button" onClick={() => setB((x) => ({ ...x, primary: p.primary, accent: p.accent }))}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] hover:bg-secondary disabled:opacity-50"
                  aria-label={`Use ${p.name} colors`}>
                  <span className="size-3 rounded-sm border" style={{ background: p.primary }} />
                  <span className="size-3 rounded-sm border" style={{ background: p.accent }} />
                  {p.name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ColorField label="Primary" value={b.primary} onChange={(v) => setB((x) => ({ ...x, primary: v }))} />
              <ColorField label="Accent" value={b.accent} onChange={(v) => setB((x) => ({ ...x, accent: v }))} />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Typeface</p>
            <Segmented label="Report typeface" value={b.font} onChange={(v) => setB((x) => ({ ...x, font: v }))}
              options={[{ v: "sans", l: "Sans" }, { v: "serif", l: "Serif" }, { v: "mono", l: "Mono" }]} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="brand-footer">Footer line</label>
            <Input id="brand-footer" value={b.footer} onChange={(e) => setB((x) => ({ ...x, footer: e.target.value }))} maxLength={120} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="brand-disclaimer">Disclaimer</label>
            <Textarea id="brand-disclaimer" rows={4} value={b.disclaimer} onChange={(e) => setB((x) => ({ ...x, disclaimer: e.target.value }))} maxLength={1200} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={b.signature} onCheckedChange={(v) => setB((x) => ({ ...x, signature: v }))} /> Show the preparing analyst on covers
          </label>
        </fieldset>
        {admin && (
          <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
            <Button variant="ghost" size="sm" type="button" onClick={() => setB({ ...DEFAULT_BRANDING })}><RotateCcw /> Defaults</Button>
            <Button variant="ink" size="sm" disabled={!dirty || save.isPending || name.trim().length < 2} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save branding"}
            </Button>
          </div>
        )}
      </Panel>

      <Panel title="Preview" subtitle="How the first page of an exported report looks." collapse={false}>
        <div className="mx-auto max-w-[560px] border shadow-paper" style={{ background: "#fff", color: "#111", fontFamily: BRAND_FONT[b.font] }}>
          <BrandedCover
            branding={b}
            logo={shownLogo}
            firmName={name}
            kicker="Company primer"
            title="NVIDIA Corporation (NVDA)"
            subtitle="Accelerated computing platform — data center, gaming, professional visualization, automotive"
            meta={<>Prepared {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}{b.signature ? " · by Jane Doe, Senior Analyst" : ""}</>}
          />
          <div className="space-y-2 px-7 py-5 text-[12px] leading-relaxed">
            <p className="font-semibold" style={{ color: b.primary === "#f4f1ea" ? "#111" : b.primary }}>Investment summary</p>
            <div className="h-2 w-11/12 rounded bg-neutral-200" />
            <div className="h-2 w-10/12 rounded bg-neutral-200" />
            <div className="h-2 w-8/12 rounded bg-neutral-200" />
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {["Revenue", "Gross margin", "FCF", "EV/Sales"].map((k) => (
                <div key={k} className="border-t-2 pt-1" style={{ borderColor: b.accent }}>
                  <p className="text-[9px] uppercase tracking-wide text-neutral-500">{k}</p>
                  <div className="mt-1 h-2.5 w-3/4 rounded bg-neutral-300" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between border-t px-7 py-2 text-[9.5px] text-neutral-500">
            <span>{b.footer}</span><span>Page 1</span>
          </div>
          <p className="px-7 pb-4 text-[9px] leading-snug text-neutral-500">{b.disclaimer}</p>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Text on the cover switches to {readableOn(b.primary) === "#ffffff" ? "white" : "black"} automatically for contrast.</p>
      </Panel>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="flex items-center gap-2 border bg-card px-2 py-1.5">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-6 cursor-pointer border-0 bg-transparent p-0" aria-label={`${label} color`} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        className="num ml-auto h-7 w-24 text-xs"
        value={text}
        onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }}
        aria-label={`${label} hex`}
      />
    </label>
  );
}
