import { useMemo } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, Globe2, Lock } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { externalLogo, RELATION_COLOR } from "./supply-map-meta";
import { normText, sidePositions, maxShare, RELATIONS, type GraphNode, type HopNode, type NodeRisk, type Relation, type ShockImpact } from "@/lib/supply/core";
import { fmtCompactUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Overlay = "none" | "single" | "concentration" | "geo" | "dollars";

type Data = { node: GraphNode; selected: boolean; focus?: boolean; hop2?: boolean; risk?: NodeRisk; overlay: Overlay; impact?: ShockImpact; dim?: boolean };

function flagged(o: Overlay, r?: NodeRisk) {
  if (!r) return false;
  return o === "single" ? r.singleSource : o === "concentration" ? r.concentrated : o === "geo" ? r.hotspots.length > 0 : o === "dollars" ? r.dollars != null : false;
}

function CompanyNode({ data }: NodeProps<Node<Data>>) {
  const { node, selected, focus, hop2, risk, overlay, impact, dim } = data;
  const share = maxShare(node);
  const hit = flagged(overlay, risk);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-l-4 bg-card px-2.5 py-2 shadow-paper transition-all hover:-translate-y-px hover:shadow-lift",
        focus ? "min-w-[180px] border-2 px-3.5 py-3" : hop2 ? "w-[170px] border-dashed py-1.5" : "w-[190px]",
        selected && "ring-2 ring-highlight",
        hit && "ring-2 ring-negative",
        impact?.severity === "high" && "bg-negative-soft",
        dim && "opacity-30",
      )}
      style={focus ? undefined : { borderLeftColor: RELATION_COLOR[node.relation] }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Handle type="source" position={Position.Right} className="!opacity-0" />
      <Handle id="t" type="target" position={Position.Top} className="!opacity-0" />
      <Handle id="b" type="source" position={Position.Bottom} className="!opacity-0" />
      <Handle id="bt" type="target" position={Position.Bottom} className="!opacity-0" />
      <Handle id="ts" type="source" position={Position.Top} className="!opacity-0" />
      <CompanyLogo ticker={node.ticker ?? node.name.slice(0, 4).toUpperCase()} src={externalLogo(node.domain, node.ticker)} size={focus ? "lg" : "sm"} />
      <div className="min-w-0">
        <p className={cn("truncate font-medium leading-tight", focus ? "text-base" : "text-xs")}>{node.name}</p>
        <p className="num flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="truncate">{node.ticker ?? "private / other"}</span>
          {share > 0 && <span className="font-semibold text-foreground">{share}%</span>}
          {risk?.dollars != null && <span className="font-semibold text-foreground">{fmtCompactUsd(risk.dollars)}</span>}
          {risk?.singleSource && <Lock className="size-2.5 text-negative" aria-label="Single source" />}
          {risk && risk.hotspots.length > 0 && <Globe2 className="size-2.5 text-negative" aria-label={risk.hotspots.join(", ")} />}
          {impact && <AlertTriangle className={cn("size-2.5", impact.severity === "high" ? "text-negative" : "text-muted-foreground")} />}
        </p>
      </div>
    </div>
  );
}
const nodeTypes = { company: CompanyNode };

const impactKey = (n: GraphNode) => n.ticker ?? normText(n.name);

export default function SupplyMap({
  focus,
  graph,
  hop2,
  visible,
  selected,
  onSelect,
  overlay,
  risks,
  impacts,
}: {
  focus: GraphNode;
  graph: GraphNode[];
  hop2: HopNode[];
  visible: Set<Relation>;
  selected: string | null;
  onSelect: (key: string) => void;
  overlay: Overlay;
  risks: Record<string, NodeRisk>;
  impacts: Map<string, ShockImpact> | null;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node<Data>[] = [{ id: "focus", type: "company", position: { x: -100, y: -32 }, data: { node: focus, selected: false, focus: true, overlay }, draggable: true }];
    const edges: Edge[] = [];
    const pos1 = new Map<string, { x: number; y: number }>();
    const dimOf = (n: GraphNode) => (impacts ? !impacts.has(impactKey(n)) : false);
    for (const r of RELATIONS) {
      if (!visible.has(r)) continue;
      const group = graph.filter((n) => n.relation === r).slice(0, 27);
      const pos = sidePositions(group.length, r);
      group.forEach((n, i) => {
        pos1.set(n.key, pos[i]);
        const risk = risks[n.key];
        nodes.push({ id: n.key, type: "company", position: { x: pos[i].x - 95, y: pos[i].y - 22 }, data: { node: n, selected: selected === n.key, risk, overlay, impact: impacts?.get(impactKey(n)), dim: dimOf(n) } });
        const share = maxShare(n);
        const supplierSide = r === "supplier";
        const hot = flagged(overlay, risk);
        edges.push({
          id: `e-${n.key}`,
          source: supplierSide ? n.key : "focus",
          target: supplierSide ? "focus" : n.key,
          ...(r === "partner" ? { sourceHandle: "ts", targetHandle: "bt" } : r === "competitor" ? { sourceHandle: "b", targetHandle: "t" } : {}),
          type: "default",
          animated: r === "customer" || r === "supplier",
          style: {
            stroke: hot ? "var(--negative)" : RELATION_COLOR[r],
            strokeWidth: 1.2 + Math.min(share, 40) / 6,
            opacity: (selected && selected !== n.key) || dimOf(n) ? 0.2 : 0.85,
            strokeDasharray: r === "competitor" ? "4 4" : undefined,
          },
        });
      });
      if (r === "supplier" || r === "customer") {
        const kids = hop2.filter((h) => h.relation === r && pos1.has(h.parent));
        const cols = Math.ceil(Math.min(group.length, 27) / 9);
        const dir = r === "supplier" ? -1 : 1;
        const pos2 = sidePositions(kids.length, r);
        kids.forEach((k, i) => {
          const x = pos2[i].x + dir * (cols * 230 + 40);
          nodes.push({ id: k.key, type: "company", position: { x: x - 85, y: pos2[i].y * 0.75 - 18 }, data: { node: k, selected: selected === k.key, hop2: true, risk: risks[k.key], overlay, impact: impacts?.get(impactKey(k)), dim: dimOf(k) } });
          edges.push({
            id: `e-${k.key}`,
            source: r === "supplier" ? k.key : k.parent,
            target: r === "supplier" ? k.parent : k.key,
            type: "default",
            style: { stroke: RELATION_COLOR[r], strokeWidth: 1 + Math.min(maxShare(k), 40) / 8, opacity: selected && selected !== k.key && selected !== k.parent ? 0.12 : 0.5, strokeDasharray: "3 3" },
          });
        });
      }
    }
    return { nodes, edges };
  }, [focus, graph, hop2, visible, selected, overlay, risks, impacts]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => n.id !== "focus" && onSelect(n.id)}
      nodesConnectable={false}
    >
      <Background gap={24} size={1} color="var(--border)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
