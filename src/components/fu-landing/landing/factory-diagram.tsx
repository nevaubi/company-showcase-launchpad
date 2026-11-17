import { useReducedMotion } from "motion/react";
import { FileStack, ScanText, Bot, Scale, ShieldCheck, Database, RefreshCw } from "lucide-react";
import type { ComponentType } from "react";
import s from "./factory-diagram.module.css";

/** Flow diagram of the real IR pipeline: collect → parse → two readers → arbiter → verify → database, with the worker loop. */
type N = { id: string; x: number; y: number; t: string; sub: string; Icon: ComponentType<{ size?: number; strokeWidth?: number }>; dark?: boolean };
const NODES: N[] = [
  { id: "collect", x: 90, y: 200, t: "Collect", sub: "filings · IR files", Icon: FileStack },
  { id: "parse", x: 290, y: 200, t: "Parse", sub: "OCR · vision", Icon: ScanText },
  { id: "a", x: 500, y: 110, t: "Reader A", sub: "model one", Icon: Bot },
  { id: "b", x: 500, y: 290, t: "Reader B", sub: "model two", Icon: Bot },
  { id: "arb", x: 710, y: 200, t: "Arbitrate", sub: "arbiter model", Icon: Scale },
  { id: "verify", x: 910, y: 200, t: "Verify", sub: "tie-out checks", Icon: ShieldCheck },
  { id: "db", x: 1100, y: 200, t: "Cited facts", sub: "all sourced", Icon: Database, dark: true },
];
const at = (id: string) => NODES.find((n) => n.id === id)!;
const W = 150, H = 64;
const EDGES: [string, string][] = [["collect", "parse"], ["parse", "a"], ["parse", "b"], ["a", "arb"], ["b", "arb"], ["arb", "verify"], ["verify", "db"]];

function path(from: string, to: string) {
  const a = at(from), b = at(to);
  const x1 = a.x + W / 2, y1 = a.y, x2 = b.x - W / 2, y2 = b.y, mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export function FactoryDiagram() {
  const reduce = useReducedMotion();
  return (
    <div className={s.frame} role="img" aria-label="Pipeline: collect, parse, two independent readers, arbitrate, verify, then cited facts; a worker loop feeds failures back to collect.">
      <div className={s.grid} aria-hidden="true" />
      <svg viewBox="0 0 1200 420" className={s.svg} aria-hidden="true">
        <defs>
          <linearGradient id="fd-edge" x1="0" x2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".15" /><stop offset="1" stopColor="currentColor" stopOpacity=".45" /></linearGradient>
          <filter id="fd-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        {/* feedback loop */}
        <path id="fd-loop" d="M1100,232 C1100,400 90,400 90,232" className={s.loop} />
        <text x="595" y="392" textAnchor="middle" className={s.loopLabel}>always-on worker loop · retries · self-heal · resume</text>
        {EDGES.map(([f, t], i) => (
          <g key={f + t}>
            <path d={path(f, t)} className={s.edge} />
            {!reduce && (
              <circle r="4" className={s.packet} filter="url(#fd-glow)">
                <animateMotion dur="2.4s" begin={`${i * 0.34}s`} repeatCount="indefinite" path={path(f, t)} />
              </circle>
            )}
            {!reduce && (
              <circle r="2.5" className={s.packetCore}>
                <animateMotion dur="2.4s" begin={`${i * 0.34}s`} repeatCount="indefinite" path={path(f, t)} />
              </circle>
            )}
          </g>
        ))}
        {!reduce && (
          <circle r="3" className={s.packetLoop}>
            <animateMotion dur="6s" repeatCount="indefinite"><mpath href="#fd-loop" /></animateMotion>
          </circle>
        )}
        {/* eval gates */}
        {[[395, 200], [605, 200], [810, 200], [1005, 200]].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <rect x="-9" y="-9" width="18" height="18" rx="4" transform="rotate(45)" className={s.gate} />
          </g>
        ))}
        <text x="700" y="30" textAnchor="middle" className={s.gateLabel}>◆ eval gate between every stage</text>
      </svg>
      {NODES.map((n, i) => (
        <div
          key={n.id}
          className={s.node}
          data-dark={n.dark || undefined}
          style={{ animationDelay: `${i * 80}ms`, left: `${((n.x - W / 2) / 1200) * 100}%`, top: `${((n.y - H / 2) / 420) * 100}%`, width: `${(W / 1200) * 100}%`, height: `${(H / 420) * 100}%` }}
        >
          <span className={s.icon}><n.Icon size={16} strokeWidth={1.8} /></span>
          <span className={s.text}><b>{n.t}</b><small>{n.sub}</small></span>
        </div>
      ))}
      <span className={s.loopBadge}><RefreshCw size={12} /> loop</span>
    </div>
  );
}
