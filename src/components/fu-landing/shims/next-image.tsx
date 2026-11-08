import type { ImgHTMLAttributes } from "react";
import { resolveMedia } from "./media";

/** Stands in for next/image outside Next.js: accepts a path string or a static import object ({ src }). */
type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | { src: string }; priority?: boolean };

export default function Image({ src, priority: _priority, ...rest }: Props) {
  const url = typeof src === "string" ? resolveMedia(src) : src.src;
  return <img src={url} decoding="async" {...rest} />;
}
