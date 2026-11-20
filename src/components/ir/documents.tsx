// One panel for a company's stored IR documents: the library, the tables parsed out of them and
// full-text search inside them (three sections used to stack under the breakdowns).
import { useState } from "react";
import { IrPanel } from "@/components/ir/panel";
import { Segmented } from "@/components/app/segmented";
import { DocSearch } from "@/components/ir/doc-search";
import { DocTables } from "@/components/ir/doc-tables";
import { IrLibrary } from "@/components/ir/library";
import type { IrDocRow } from "@/lib/ir.functions";
import type { StoreDoc } from "@/lib/ir/store";

type Tab = "library" | "tables" | "search";

export function IrDocuments({ ticker, documents, images, store }: { ticker: string; documents: IrDocRow[]; images?: number; store?: StoreDoc[] }) {
  const [tab, setTab] = useState<Tab>("library");
  const files = documents.length + (images ?? 0);
  return (
    <IrPanel
      section="Source documents"
      title="Source documents"
      subtitle={tab === "library" ? "Earnings releases, supplements, presentations and data files from EDGAR and company IR sites" : tab === "tables" ? "Tables parsed out of the stored documents, as printed" : "Full-text search inside the stored documents"}
      actions={
        <Segmented
          label="Documents view"
          size="xs"
          value={tab}
          onChange={setTab}
          options={[
            { v: "library", l: `Library · ${files.toLocaleString()}` },
            { v: "tables", l: "Tables" },
            { v: "search", l: "Search" },
          ]}
        />
      }
      bodyClassName="p-0"
    >
      {tab === "library" && <IrLibrary ticker={ticker} documents={documents} images={images} store={store} embedded />}
      {tab === "tables" && <DocTables ticker={ticker} embedded />}
      {tab === "search" && <DocSearch ticker={ticker} embedded />}
    </IrPanel>
  );
}
