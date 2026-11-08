import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
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
        <ShieldCheck size={16} aria-hidden="true" />
        {secondaryAction.label}
      </a>
    </div>
  );
}

const defaultPrimary: VideoHeroAction = { label: "Join waitlist", href: "/auth" };
const defaultSecondary: VideoHeroAction = { label: "See how we verify", href: "#verification" };

/* ------------------------------------------------------------------ */
/* 1. Full-bleed cinematic: night aerial, centered copy, filing ticker */
/* ------------------------------------------------------------------ */

export interface TapeRow {
  /** Ticker. */
  t: string;
  /** Source document, e.g. "10-Q" or "8-K Ex. 99.3". */
  f: string;
  /** What was checked. */
  n: string;
  /** Result of the check. */
  d: string;
}

export interface NightHeroCopy {
  eyebrow: string;
  title: string;
  lede: string;
  /** Short proof points under the buttons. Omit or pass [] to hide. */
  proof?: string[];
  tapeLabel?: string;
  tape?: TapeRow[];
}

export const defaultTape: TapeRow[] = [
  { t: "BAC", f: "8-K Ex. 99.3", n: "Segment net income sums to consolidated", d: "reconciled" },
  { t: "JPM", f: "10-Q", n: "XBRL facts matched to rendered tables", d: "verified" },
  { t: "CME", f: "8-K", n: "Volume figures traced to source page", d: "cited" },
  { t: "ADM", f: "10-K", n: "Five-year history backfilled", d: "complete" },
  { t: "MCD", f: "10-Q", n: "Prior period re-checked against new filing", d: "no drift" },
  { t: "WFC", f: "10-Q", n: "Card charge-off rates tied to supplement", d: "verified" },
  { t: "BA", f: "8-K", n: "Delivery counts cross-checked with release", d: "matched" },
  { t: "NTRS", f: "10-Q", n: "AUC/A pulled with page reference", d: "cited" },
];

export const defaultNightCopy: NightHeroCopy = {
  eyebrow: "Source-grounded financial research",
  title: "The most intelligent AI for financial markets research",
  lede: "FiledUnder reads every filing, backfills the complete history and re-checks every number as new data lands. Each figure links to the exact page it came from.",
  proof: ["Full history backfilled", "Continuous accuracy checks", "Every number cited"],
  tapeLabel: "Recent verification checks",
  tape: defaultTape,
};

export function ChicagoNightVideoHero({
  primaryAction = defaultPrimary,
  secondaryAction = defaultSecondary,
  clip = clips.nightAerial,
  copy = defaultNightCopy,
  id = "vh-night-title",
  className,
}: Actions & { clip?: VideoClip; copy?: NightHeroCopy; id?: string; className?: string }) {
  const tape = copy.tape ?? defaultTape;
  const proof = copy.proof ?? [];
  return (
    <section className={[styles.frame, styles.tall, className].filter(Boolean).join(" ")} aria-labelledby={id}>
      <VideoBackdrop clip={clip} scrim="strong" controlPosition="top-right">
        <motion.div className={styles.centerCopy} variants={group} initial={false} animate="shown">
          <motion.p variants={rise} className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" />
            {copy.eyebrow}
          </motion.p>
          <motion.h1 id={id} variants={rise} className={styles.title}>
            {copy.title}
          </motion.h1>
          <motion.p variants={rise} className={styles.lede}>
            {copy.lede}
          </motion.p>
          <motion.div variants={rise}>
            <HeroButtons primaryAction={primaryAction} secondaryAction={secondaryAction} />
          </motion.div>
          {proof.length > 0 && (
            <motion.ul variants={rise} className={styles.proof} aria-label="How accuracy is kept">
              {proof.map((item) => (
                <li key={item}>
                  <Check size={14} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </motion.ul>
          )}
        </motion.div>
        {tape.length > 0 && (
          <div className={styles.tape} aria-label={copy.tapeLabel ?? "Recent verification checks"}>
            <div className={styles.tapeTrack}>
              {[...tape, ...tape].map((row, i) => (
                <span key={i} className={styles.tapeItem} aria-hidden={i >= tape.length || undefined}>
                  <b>{row.t}</b>
                  <em>{row.f}</em>
                  {row.n}
                  <i><Check size={12} aria-hidden="true" />{row.d}</i>
                </span>
              ))}
            </div>
          </div>
        )}
      </VideoBackdrop>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Split: copy left on surface, video panel right with scene chips  */
/* ------------------------------------------------------------------ */

const scenes = [
  { key: "riverDusk", name: "River, dusk", clip: clips.riverDusk },
  { key: "lakefront", name: "Lakefront", clip: clips.lakefront },
  { key: "goldCoast", name: "Gold Coast", clip: clips.goldCoast },
] as const;

export interface SplitHeroCopy {
  eyebrow: string;
  title: string;
  lede: string;
  /** Up to three label/value pairs under the buttons. */
  facts: { label: string; value: string }[];
}

export const defaultSplitCopy: SplitHeroCopy = {
  eyebrow: "FiledUnder for analysts",
  title: "Research you can source, line by line",
  lede: "Complete filing history, maintained as companies report and restate. Every figure reconciled, re-checked and linked to the page it came from.",
  facts: [
    { label: "History", value: "Backfilled" },
    { label: "Checks", value: "Every filing" },
    { label: "Citations", value: "Every number" },
  ],
};

export function ChicagoSplitVideoHero({ primaryAction = defaultPrimary, secondaryAction = defaultSecondary, copy = defaultSplitCopy, className }: Actions & { copy?: SplitHeroCopy; className?: string }) {
  const [active, setActive] = useState(0);
  const scene = scenes[active];
  return (
    <section className={[styles.split, className].filter(Boolean).join(" ")} aria-labelledby="vh-split-title">
      <motion.div className={styles.splitCopy} variants={group} initial={false} animate="shown">
        <motion.p variants={rise} className={styles.eyebrowMuted}>{copy.eyebrow}</motion.p>
        <motion.h1 id="vh-split-title" variants={rise} className={styles.titleDark}>
          {copy.title}
        </motion.h1>
        <motion.p variants={rise} className={styles.ledeDark}>
          {copy.lede}
        </motion.p>
        <motion.div variants={rise}>
          <HeroButtons primaryAction={primaryAction} secondaryAction={secondaryAction} />
        </motion.div>
        <motion.dl variants={rise} className={styles.stats}>
          {copy.facts.map((f) => (
            <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
          ))}
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
/* ------------------------------------------------------------------ */

// Bank of America 3Q26 vs 3Q25, from the earnings supplement (8-K Exhibit 99.3). $ in billions except per share.
const recapLines = [
  { k: "Net income", v: "$6.9B", d: "-17% y/y" },
  { k: "Diluted EPS", v: "$0.91", d: "-13% y/y" },
  { k: "Net interest income", v: "$16.4B", d: "+8% y/y" },
  { k: "Consumer Banking NI", v: "$3.5B", d: "+2% y/y" },
];

export interface MarketsHeroCopy {
  eyebrow: string;
  title: string;
  lede: string;
}

export const defaultMarketsCopy: MarketsHeroCopy = {
  eyebrow: "Markets move on the filing, not the headline",
  title: "Read the 8\u2011K before the tape does",
  lede: "FiledUnder parses the release, the supplement and the call into a cited recap your desk can trade on.",
};

export function MarketsVideoHero({ primaryAction = defaultPrimary, secondaryAction = defaultSecondary, copy = defaultMarketsCopy, className }: Actions & { copy?: MarketsHeroCopy; className?: string }) {
  return (
    <section className={[styles.frame, styles.tall, className].filter(Boolean).join(" ")} aria-labelledby="vh-market-title">
      <VideoBackdrop clip={clips.marketTerminal} scrim="side" controlPosition="bottom-right">
        <div className={styles.marketGrid}>
          <motion.div className={styles.leftCopy} variants={group} initial={false} animate="shown">
            <motion.p variants={rise} className={styles.eyebrow}>
              <span className={styles.liveDot} aria-hidden="true" />
              {copy.eyebrow}
            </motion.p>
            <motion.h1 id="vh-market-title" variants={rise} className={[styles.title, styles.titleLeft].join(" ")}>
              {copy.title}
            </motion.h1>
            <motion.p variants={rise} className={[styles.lede, styles.ledeLeft].join(" ")}>
              {copy.lede}
            </motion.p>
            <motion.div variants={rise}>
              <HeroButtons primaryAction={primaryAction} secondaryAction={secondaryAction} />
            </motion.div>
          </motion.div>
          <motion.aside
            className={styles.card}
            aria-label="Example recap"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.55, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className={styles.cardHead}>
              <span className={styles.badge}>8-K · Ex. 99.3</span>
              <span className={styles.cardMeta}>Drafted 3m 41s after filing</span>
            </header>
            <p className={styles.cardTitle}>BAC 3Q26 recap</p>
            <ul className={styles.cardRows}>
              {recapLines.map((r, i) => (
                <motion.li
                  key={r.k}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.9 + i * 0.12, duration: 0.5 }}
                >
                  <span>{r.k}</span>
                  <strong>{r.v}</strong>
                  <em data-neg={r.d.startsWith("-") || undefined}>{r.d.replace("-", "\u2212")}</em>
                  <sup>[{i + 1}]</sup>
                </motion.li>
              ))}
            </ul>
            <p className={styles.cardFoot}>4 citations · supplement p.2, p.4, p.11</p>
          </motion.aside>
        </div>
      </VideoBackdrop>
    </section>
  );
}

export default ChicagoNightVideoHero;
