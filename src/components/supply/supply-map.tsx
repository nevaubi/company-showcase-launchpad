import { useMemo } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CompanyLogo } from "@/components/app/company-logo";
import { externalLogo, RELATION_COLOR } from "./supply-map-meta";
import { sidePositions, maxShare, RELATIONS, type GraphNode, type Relation } from "@/lib/supply/core";
import { cn } from "@/lib/utils";

type Data = { node: GraphNode; selected: boolean; focus?: boolean };

function CompanyNode({ data }: NodeProps<Node<Data>>) {
  const { node, selected, focus } = data;
  const share = maxShare(node);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 shadow-paper transition-shadow",
        focus ? "min-w-[180px] border-2 px-3.5 py-3" : "w-[190px]",
        selected && "ring-2 ring-highlight",
      )}
      style={{ borderColor: focus ? undefined : RELATION_COLOR[node.relation] }}
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
        <p className="num text-[10px] text-muted-foreground">
          {node.ticker ?? "private / other"}
          {share > 0 && <span className="ml-1 font-semibold text-foreground">{share}%</span>}
        </p>
      </div>
    </div>
  );
}
const nodeTypes = { company: CompanyNode };

export default function SupplyMap({
  focus,
  graph,
  visible,
  selected,
  onSelect,
}: {
  focus: GraphNode;
  graph: GraphNode[];
  visible: Set<Relation>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node<Data>[] = [{ id: "focus", type: "company", position: { x: -100, y: -32 }, data: { node: focus, selected: false, focus: true }, draggable: true }];
    const edges: Edge[] = [];
    for (const r of RELATIONS) {
      if (!visible.has(r)) continue;
      const group = graph.filter((n) => n.relation === r).slice(0, 27);
      const pos = sidePositions(group.length, r);
      group.forEach((n, i) => {
        nodes.push({ id: n.key, type: "company", position: { x: pos[i].x - 95, y: pos[i].y - 22 }, data: { node: n, selected: selected === n.key } });
        const share = maxShare(n);
        const supplierSide = r === "supplier";
        edges.push({
          id: `e-${n.key}`,
          source: supplierSide ? n.key : "focus",
          target: supplierSide ? "focus" : n.key,
          ...(r === "partner" ? { sourceHandle: "ts", targetHandle: "bt" } : r === "competitor" ? { sourceHandle: "b", targetHandle: "t" } : {}),
          type: "default",
          animated: r === "customer" || r === "supplier",
          style: { stroke: RELATION_COLOR[r], strokeWidth: 1.2 + Math.min(share, 40) / 6, opacity: selected && selected !== n.key ? 0.25 : 0.85, strokeDasharray: r === "competitor" ? "4 4" : undefined },
        });
      });
    }
    return { nodes, edges };
  }, [focus, graph, visible, selected]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.3}
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
