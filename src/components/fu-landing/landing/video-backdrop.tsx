import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import styles from "./hero-video.module.css";

export interface VideoClip {
  /** H.264 MP4, muted, short seamless loop. */
  src: string;
  /** JPG frame shown before playback starts and for visitors who prefer reduced motion. */
  poster: string;
  /** Short description for the pause control and credits, e.g. "Aerial of the Loop at night". */
  label: string;
  /** Pexels credit, shown in the corner. */
  credit?: { author: string; href: string };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export interface VideoBackdropProps {
  clip: VideoClip;
  /** Scrim strength. "strong" for centered copy, "side" darkens the left half for left-aligned copy. */
  scrim?: "strong" | "soft" | "side" | "bottom";
  /** Where the pause control sits. */
  controlPosition?: "bottom-right" | "top-right";
  showCredit?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Full-bleed looping background video. Autoplays muted and inline, pauses while offscreen,
 * shows only the poster when the visitor prefers reduced motion, and always exposes a pause control
 * (WCAG 2.2.2 requires one for motion longer than five seconds).
 */
export function VideoBackdrop({ clip, scrim = "strong", controlPosition = "bottom-right", showCredit = true, className, children }: VideoBackdropProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [userPaused, setUserPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const shouldPlay = !reduced && !userPaused && visible;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (shouldPlay) {
      const attempt = video.play();
      if (attempt && typeof attempt.catch === "function") attempt.catch(() => undefined);
    } else {
      video.pause();
    }
  }, [shouldPlay, clip.src]);

  useEffect(() => { setReady(false); }, [clip.src]);

  return (
    <div ref={rootRef} className={[styles.backdrop, className].filter(Boolean).join(" ")}>
      <img className={styles.poster} src={clip.poster} alt="" aria-hidden="true" decoding="async" />
      {!reduced && (
        <video
          key={clip.src}
          ref={videoRef}
          className={styles.video}
          data-ready={ready || undefined}
          src={clip.src}
          poster={clip.poster}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          disablePictureInPicture
          onCanPlay={() => setReady(true)}
        />
      )}
      <div className={styles.scrim} data-scrim={scrim} aria-hidden="true" />
      <div className={styles.grain} aria-hidden="true" />
      {children}
      {!reduced && (
        <button
          type="button"
          className={styles.control}
          data-position={controlPosition}
          onClick={() => setUserPaused((p) => !p)}
          aria-pressed={userPaused}
          aria-label={userPaused ? `Play background video: ${clip.label}` : `Pause background video: ${clip.label}`}
        >
          {userPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
      )}
      {showCredit && clip.credit && (
        <a className={styles.credit} href={clip.credit.href} target="_blank" rel="noreferrer">
          Video: {clip.credit.author} / Pexels
        </a>
      )}
    </div>
  );
}

export default VideoBackdrop;
