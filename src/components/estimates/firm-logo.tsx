import { useState } from "react";
import { cn } from "@/lib/utils";

/** Official website of each sell-side firm, used to load its logo mark. */
const FIRM_DOMAIN: Record<string, string> = {
  "wells fargo": "wellsfargo.com", ubs: "ubs.com", "morgan stanley": "morganstanley.com", citigroup: "citigroup.com",
  barclays: "barclays.com", "jp morgan": "jpmorgan.com", "rbc capital": "rbccm.com", "truist securities": "truist.com",
  "b of a securities": "bankofamerica.com", "evercore isi group": "evercore.com", "piper sandler": "pipersandler.com",
  "td cowen": "cowen.com", mizuho: "mizuhogroup.com", "cantor fitzgerald": "cantor.com", "bmo capital": "bmo.com",
  stifel: "stifel.com", rosenblatt: "rblt.com", guggenheim: "guggenheimpartners.com", wedbush: "wedbush.com",
  keybanc: "key.com", jefferies: "jefferies.com", oppenheimer: "oppenheimer.com", "da davidson": "dadavidson.com",
  bernstein: "bernstein.com", "goldman sachs": "goldmansachs.com", baird: "rwbaird.com", needham: "needhamco.com",
  scotiabank: "scotiabank.com", susquehanna: "sig.com", btig: "btig.com", "telsey advisory group": "telseygroup.com",
  "raymond james": "raymondjames.com", benchmark: "benchmarkcompany.com", "deutsche bank": "db.com",
  "freedom broker": "freedombroker.com", hsbc: "hsbc.com", "jmp securities": "jmpsecurities.com", "argus research": "argusresearch.com",
  "keefe, bruyette & woods": "kbw.com", "canaccord genuity": "canaccordgenuity.com", citizens: "citizensbank.com",
  "loop capital": "loopcapital.com", "wolfe research": "wolferesearch.com", "tigress financial": "tigressfp.com",
  macquarie: "macquarie.com", "seaport global": "seaportglobal.com", "bnp paribas": "bnpparibas.com",
  "melius research": "meliusresearch.com", "roth capital": "roth.com", "leerink partners": "leerink.com",
  "td securities": "tdsecurities.com", stonex: "stonex.com", "glj research": "glj-research.com", "stephens & co.": "stephens.com",
  "westpark capital": "wpcapital.com", "pivotal research": "pvtl.com", cicc: "cicc.com", "redburn atlantic": "redburnatlantic.com",
  "rothschild & co": "rothschildandco.com", "citizens capital markets": "citizensbank.com", clsa: "clsa.com",
  "daiwa capital": "daiwa.co.jp", "northland capital markets": "northlandcapitalmarkets.com", "roth mkm": "roth.com",
  "b. riley securities": "brileysecurities.com", "kgi securities": "kgi.com", "erste group": "erstegroup.com",
  "china renaissance": "chinarenaissance.com", "compass point": "compasspointllc.com", "william blair": "williamblair.com",
  moffettnathanson: "moffettnathanson.com", berenberg: "berenberg.de", "freedom capital markets": "freedomcapitalmarkets.com",
  "maxim group": "maximgrp.com", "new street research": "newstreetresearch.com", "monness, crespi, hardt": "monness.com",
  "monness": "monness.com", "craig-hallum": "craig-hallum.com", "bwg global": "bwgstrategy.com", "phillip securities": "phillip.com.sg",
  cfra: "cfraresearch.com", "itau bba": "itau.com.br", "vertical research": "verticalresearchpartners.com",
  "ladenburg thalmann": "ladenburg.com", "williams trading": "williamstrading.com", "johnson rice": "johnsonrice.com",
  "lynx global": "lynxglobal.com", "northcoast research": "northcoastresearch.com", "bnp paribas exane": "exane.com",
  "dz bank": "dzbank.com", cibc: "cibc.com", "gordon haskett": "gordonhaskett.com", "credit suisse": "credit-suisse.com",
  nomura: "nomura.com", "atlantic equities": "atlanticequities.com", "hsbc securities": "hsbc.com", "sanford c. bernstein": "bernstein.com",
};

export const firmDomain = (firm: string) => FIRM_DOMAIN[firm.trim().toLowerCase()] ?? null;

/** A firm's logo mark, or its initials on a neutral tile when no logo is known or it fails to load. */
export function FirmLogo({ firm, className }: { firm: string; className?: string }) {
  const domain = firmDomain(firm);
  const [failed, setFailed] = useState(false);
  const initials = firm.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-card", className)}>
      {domain && !failed ? (
        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt="" loading="lazy" className="size-full object-contain p-0.5" onError={() => setFailed(true)} />
      ) : (
        <span className="text-[8px] font-semibold text-muted-foreground">{initials}</span>
      )}
    </span>
  );
}
