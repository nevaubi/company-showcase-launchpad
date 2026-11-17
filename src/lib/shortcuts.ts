/** One list drives both the keyboard handler and the shortcuts sheet, so they never drift. */
export type Shortcut = { keys: string[]; label: string; group: "Navigation" | "Company pages" | "Assistant" | "Help"; to?: string; action?: string };

export const SHORTCUTS: Shortcut[] = [
  { keys: ["⌘", "K"], label: "Search companies, pages and filings", group: "Navigation", action: "search" },
  { keys: ["/"], label: "Search", group: "Navigation", action: "search" },
  { keys: ["G", "D"], label: "Go to dashboard", group: "Navigation", to: "/app" },
  { keys: ["G", "C"], label: "Go to companies", group: "Navigation", to: "/app/companies" },
  { keys: ["G", "O"], label: "Go to Office Studio", group: "Navigation", to: "/app/office" },
  { keys: ["G", "R"], label: "Go to reports", group: "Navigation", to: "/app/reports" },
  { keys: ["G", "F"], label: "Go to filings", group: "Navigation", to: "/app/filings" },
  { keys: ["G", "M"], label: "Go to markets", group: "Navigation", to: "/app/markets" },
  { keys: ["["], label: "Previous tab", group: "Company pages", action: "prev-tab" },
  { keys: ["]"], label: "Next tab", group: "Company pages", action: "next-tab" },
  { keys: ["⌘", "J"], label: "Open or close the assistant", group: "Assistant", action: "assistant" },
  { keys: ["Esc"], label: "Close panels and dialogs", group: "Assistant" },
  { keys: ["?"], label: "Show keyboard shortcuts", group: "Help", action: "shortcuts" },
];

/** Single-key shortcuts must never fire while the user is typing or inside an editor. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).closest !== "function") return false;
  const h = el as HTMLElement;
  if (h.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(h.tagName)) return true;
  return !!h.closest("[contenteditable='true'], [role='grid'], [data-office-editor], [role='dialog']");
}

/** Resolves a two-key "G then X" sequence to its destination. */
export function sequenceTarget(first: string, second: string): string | undefined {
  return SHORTCUTS.find((s) => s.keys.length === 2 && s.keys[0] === first.toUpperCase() && s.keys[1] === second.toUpperCase() && s.to)?.to;
}
