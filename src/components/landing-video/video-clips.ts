import type { VideoClip } from "./video-backdrop";
import nightMp4 from "./assets/chicago-night-aerial.mp4.asset.json";
import nightJpg from "./assets/chicago-night-aerial.jpg.asset.json";
import riverMp4 from "./assets/chicago-river-dusk.mp4.asset.json";
import riverJpg from "./assets/chicago-river-dusk.jpg.asset.json";
import goldMp4 from "./assets/chicago-gold-coast.mp4.asset.json";
import goldJpg from "./assets/chicago-gold-coast.jpg.asset.json";

// Pexels license clips (commercial use allowed).
export const clips = {
  nightAerial: { src: nightMp4.url, poster: nightJpg.url, label: "Aerial of downtown Chicago at night", credit: { author: "Yura Forrat", href: "https://www.pexels.com/video/36244312/" } },
  riverDusk: { src: riverMp4.url, poster: riverJpg.url, label: "Drone pass over the Chicago River at dusk", credit: { author: "Ricky Esquivel", href: "https://www.pexels.com/video/1826896/" } },
  goldCoast: { src: goldMp4.url, poster: goldJpg.url, label: "Aerial of the Gold Coast and Lake Shore Drive", credit: { author: "K", href: "https://www.pexels.com/video/26561931/" } },
} satisfies Record<string, VideoClip>;
