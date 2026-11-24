import { useEffect, useRef, useState } from "react";

/**
 * A words box held in the address. The box types into local state and the address follows `delay` ms
 * later with the trimmed value. The box takes the address value back only on an outside navigation
 * (back button, a link, Clear): never when the address merely caught up with what was typed, because
 * that would trim a space typed after a pause ("earnings " + "2025" became "earnings2025").
 */
export function useSearchText(q: string | undefined, commit: (q: string | undefined) => void, delay = 200) {
  const [text, setText] = useState(q ?? "");
  const textRef = useRef(text);
  textRef.current = text;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const v = q ?? "";
    if (sent.current !== null && v === sent.current) return;
    sent.current = null;
    if (v !== textRef.current.trim()) setText(v);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      const v = text.trim();
      if ((q ?? "") === v) return;
      sent.current = v;
      commitRef.current(v || undefined);
    }, delay);
    return () => clearTimeout(t);
    // q is read at fire time only; a change of q alone must not re-send
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, delay]);

  return [text, setText] as const;
}
