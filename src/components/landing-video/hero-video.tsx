import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FileText } from "lucide-react";
import { VideoBackdrop, type VideoClip } from "./video-backdrop";
import { clips } from "./video-clips";
import styles from "./hero-video.module.css";

const rise = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } },
};
const group = { hidden: {}, shown: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } } };

export interface VideoHeroAction {
  label: string;
  href: string;
}

interface Actions {
  primaryAction?: VideoHeroAction;
  secondaryAction?: VideoHeroAction;
}

function HeroButtons({ primaryAction, secondaryAction }: Required<Actions>) {
  return (
    <div className={styles.actions}>
      <a className={styles.primary} href={primaryAction.href}>
        {primaryAction.label}
        <ArrowRight size={16} aria-hidden="true" />
      </a>
      <a className={styles.secondary} href={secondaryAction.href}>
        <FileText size={16} aria-hidden="true" />
        {secondaryAction.label}
      </a>
    </div>
  );
}

const defaultPrimary: VideoHeroAction = { label: "Start free", href: "#start" };
const defaultSecondary: VideoHeroAction = { label: "See a sample memo", href: "#sample" };

/* ------------------------------------------------------------------ */
/* 1. Full-bleed cinematic: night aerial, centered copy, filing ticker */
/* ------------------------------------------------------------------ */

const tape = [
  { t: "BAC", f: "8-K", n: "3Q26 EPS $0.91", d: "recap drafted" },
  { t: "JPM", f: "10-Q", n: "Segment tables rebuilt", d: "12 citations" },
  { t: "CME", f: "8-K", n: "Monthly volume parsed", d: "Chicago" },
  { t: "ADM", f: "10-Q", n: "Segment margins compared", d: "Chicago" },
  { t: "BA", f: "8-K", n: "Deliveries logged", d: "Arlington" },
  { t: "MCD", f: "8-K", n: "Comparable sales parsed", d: "Chicago" },
  { t: "WFC", f: "10-Q", n: "Card NCOs tracked", d: "8 citations" },
  { t: "NTRS", f: "8-K", n: "AUC/A extracted", d: "Chicago" },
];

export function ChicagoNightVideoHero({ primaryAction = defaultPrimary, secondaryAction = defaultSecondary, clip = clips.nightAerial, className }: Actions & { clip?: VideoClip; className?: string }) {
  return (
    <section className={[styles.frame, styles.tall, className].filter(Boolean).join(" ")} aria-labelledby="vh-night-title">
      <VideoBackdrop clip={clip} scrim="strong" controlPosition="top-right">
        <motion.div className={styles.centerCopy} variants={group} initial="hidden" animate="shown">
          <motion.p variants={rise} className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" />
            Built in Chicago. Reading every filing as it lands.
          </motion.p>
          <motion.h1 id="vh-night-title" variants={rise} className={styles.title}>
            Equity research, written from the filings
          </motion.h1>
          <motion.p variants={rise} className={styles.lede}>
            Filed Under reads 8-Ks, 10-Qs and earnings calls the minute they post, then drafts the memo your team would have written, with a citation on every number.
          </motion.p>
          <motion.div variants={rise}>
            <HeroButtons primaryAction={primaryAction} secondaryAction={secondaryAction} />
          </motion.div>
        </motion.div>
        <div className={styles.tape} aria-label="Recent filings">
          <div className={styles.tapeTrack}>
            {[...tape, ...tape].map((row, i) => (
              <span key={i} className={styles.tapeItem} aria-hidden={i >= tape.length || undefined}>
                <b>{row.t}</b>
                <em>{row.f}</em>
                {row.n}
                <i>{row.d}</i>
              </span>
            ))}
          </div>
        </div>
      </VideoBackdrop>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Split: copy left on surface, video panel right with scene chips  */
/* ------------------------------------------------------------------ */

const scenes = [
  { key: "riverDusk", name: "River, dusk", clip: clips.riverDusk },
  { key: "goldCoast", name: "Gold Coast", clip: clips.goldCoast },
] as const;

export function ChicagoSplitVideoHero({ primaryAction = defaultPrimary, secondaryAction = defaultSecondary, className }: Actions & { className?: string }) {
  const [active, setActive] = useState(0);
  const scene = scenes[active];
  return (
    <section className={[styles.split, className].filter(Boolean).join(" ")} aria-labelledby="vh-split-title">
      <motion.div className={styles.splitCopy} variants={group} initial="hidden" animate="shown">
        <motion.p variants={rise} className={styles.eyebrowMuted}>Filed Under for analysts</motion.p>
        <motion.h1 id="vh-split-title" variants={rise} className={styles.titleDark}>
          The first draft of every earnings memo, before the open
        </motion.h1>
        <motion.p variants={rise} className={styles.ledeDark}>
          Segment tables rebuilt from the supplement. Guidance changes flagged against last quarter. Every figure linked to the page it came from.
        </motion.p>
        <motion.div variants={rise}>
          <HeroButtons primaryAction={primaryAction} secondaryAction={secondaryAction} />
        </motion.div>
        <motion.dl variants={rise} className={styles.stats}>
          <div><dt>Median time to draft</dt><dd>4 min</dd></div>
          <div><dt>Filers covered</dt><dd>6,200+</dd></div>
          <div><dt>Numbers cited</dt><dd>100%</dd></div>
        </motion.dl>
      </motion.div>
      <div className={styles.splitMedia}>
        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            key={scene.key}
            className={styles.splitLayer}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
          >
            <VideoBackdrop clip={scene.clip} scrim="bottom" controlPosition="top-right" />
          </motion.div>
        </AnimatePresence>
        <div className={styles.chips} role="tablist" aria-label="Background scene">
          {scenes.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={styles.chip}
              onClick={() => setActive(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Markets: trading terminal footage with a drafted recap card      */
