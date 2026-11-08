import type { VideoClip } from "./video-backdrop";
import { assetUrl } from "./asset-urls";

/**
 * All clips are from Pexels (free license: commercial use allowed, no attribution required, credit appreciated).
 * Re-encoded to 1920x1080 H.264, 30fps, muted, with a 1s crossfade so each one loops without a visible cut.
 * Files live in /public/videos. Change BASE if you host them on a CDN.
 */

export const clips = {
  nightAerial: {
    src: assetUrl("chicago-night-aerial.mp4"),
    poster: assetUrl("chicago-night-aerial.jpg"),
    label: "Aerial of downtown Chicago at night",
    credit: { author: "Yura Forrat", href: "https://www.pexels.com/video/36244312/" },
  },
  riverDusk: {
    src: assetUrl("chicago-river-dusk.mp4"),
    poster: assetUrl("chicago-river-dusk.jpg"),
    label: "Drone pass over the Chicago River at dusk",
    credit: { author: "Ricky Esquivel", href: "https://www.pexels.com/video/1826896/" },
  },
  lakefront: {
    src: assetUrl("chicago-lakefront.mp4"),
    poster: assetUrl("chicago-lakefront.jpg"),
    label: "Chicago skyline from Lake Michigan under overcast sky",
    credit: { author: "Airam Dato-on", href: "https://www.pexels.com/video/38004344/" },
  },
  goldCoast: {
    src: assetUrl("chicago-gold-coast.mp4"),
    poster: assetUrl("chicago-gold-coast.jpg"),
    label: "Aerial of the Gold Coast and Lake Shore Drive",
    credit: { author: "K", href: "https://www.pexels.com/video/26561931/" },
  },
  marketTerminal: {
    src: assetUrl("market-terminal.mp4"),
    poster: assetUrl("market-terminal.jpg"),
    label: "Trading terminal with candlestick charts",
    credit: { author: "Gilmer Diaz Estela", href: "https://www.pexels.com/video/14003933/" },
  },
} satisfies Record<string, VideoClip>;

export type ClipKey = keyof typeof clips;
