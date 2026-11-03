import { Segmented } from "@/components/app/segmented";
import { useUnitScale } from "@/hooks/use-preference";
import { SCALES } from "@/lib/format";

/** Full / $K / $M / $B toggle. The choice is remembered and shared by every financial table. */
export function ScaleToggle({ size = "sm", className }: { size?: "xs" | "sm"; className?: string }) {
  const [scale, setScale] = useUnitScale();
  return <Segmented label="Value scale" value={scale} onChange={setScale} options={SCALES} size={size} className={className} />;
}
