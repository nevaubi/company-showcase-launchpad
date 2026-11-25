import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";
import { useRouter } from "@tanstack/react-router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** An in-app address as the shared link builders write it: path, search and hash. */
  href: string;
  replace?: boolean;
  resetScroll?: boolean;
  ref?: Ref<HTMLAnchorElement>;
};

/** A plain left click; a modified click, a middle click or another target keeps the browser's own behaviour. */
export function isPlainClick(e: Pick<MouseEvent, "button" | "metaKey" | "altKey" | "ctrlKey" | "shiftKey" | "defaultPrevented">, target?: string) {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && (!target || target === "_self");
}

/**
 * A link to an address built as a string (`datasetHref`, `collectionHref`, ...): a real anchor that opens in a
 * new tab and that the assistant can follow, navigated inside the app on a plain click, like the router's `Link`.
 */
export function HrefLink({ href, onClick, replace, resetScroll, target, ref, ...rest }: Props) {
  const router = useRouter();
  return (
    <a
      ref={ref}
      href={router.history.createHref(href)}
      target={target}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (!isPlainClick(e, target)) return;
        e.preventDefault();
        void router.navigate({ href, replace, resetScroll });
      }}
    />
  );
}
