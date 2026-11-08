import { motion } from "motion/react";
import { DotGrid } from "../components/arc/dot-grid/dot-grid";
import { SandText } from "../components/arc/sand-text/sand-text";
import { ActionLink, type HeroAction } from "../components/arc/blocks/hero-section/hero-content";
import { heroGroup, heroRise } from "../components/arc/blocks/hero-section/hero-motion";
import shell from "../components/arc/blocks/hero-section/hero-section.module.css";
import styles from "./heroes.module.css";

export interface FiledUnderSandHeroProps {
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  className?: string;
}

/**
 * Wordmark hero: the name pours in as sand and crumbles where the pointer digs, over a dot field that bulges around the
 * pointer and ripples on click. The name is the page's h1 for screen readers; the tagline carries the pitch.
 */
export function FiledUnderSandHero({
  primaryAction = { label: "Start free", doneLabel: "Workspace created" },
  secondaryAction = { label: "See a sample memo", doneLabel: "Opening the memo" },
  className,
}: FiledUnderSandHeroProps) {
  return <section className={[shell.hero, styles.frame, className].filter(Boolean).join(" ")}>
    <DotGrid className={styles.dots} gap={24} radius={170} strength={18}>
      <div className={styles.fill}><motion.div className={styles.center} variants={heroGroup} initial="hidden" animate="shown">
        <motion.div variants={heroRise} className={styles.sandWrap}>
          <SandText text="FiledUnder" as="h1" className={styles.sand} grain={2} radius={16} />
        </motion.div>
        <motion.p variants={heroRise} className={[shell.description, styles.lede].join(" ")}>
          The research desk that never misses a filing. Recaps, models and cited answers for every company you cover.
        </motion.p>
        <motion.div variants={heroRise} className={styles.actions}>
          <ActionLink action={primaryAction} kind="primary" />
          <ActionLink action={secondaryAction} kind="secondary" />
        </motion.div>
        <motion.p variants={heroRise} className={styles.fine}>Move your pointer through the letters.</motion.p>
      </motion.div></div>
    </DotGrid>
  </section>;
}

export default FiledUnderSandHero;
