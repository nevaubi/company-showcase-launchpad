import type { CSSProperties } from "react";

/**
 * A cell with no figure: the dash in the muted text colour, not the shared style's fainter mix, so it keeps
 * at least 4.5:1 against the card and the stripes in both themes (measured 3.3:1 in light with the mix).
 */
export const MISSING: CSSProperties = { color: "var(--muted-foreground)" };
