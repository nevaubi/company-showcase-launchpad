import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUTS } from "@/lib/shortcuts";

const GROUPS = ["Navigation", "Company pages", "Assistant", "Help"] as const;

export function ShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>“G then D” means press G, then D. Single keys don't fire while you're typing.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g} className="min-w-0">
              <p className="mb-1.5 text-xs text-muted-foreground">{g}</p>
              <ul className="space-y-1">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.keys.join("+")} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{s.label}</span>
                    <span className="flex shrink-0 gap-1">{s.keys.map((k) => <kbd key={k} className="num min-w-5 rounded border bg-muted px-1.5 text-center text-[11px]">{k}</kbd>)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
