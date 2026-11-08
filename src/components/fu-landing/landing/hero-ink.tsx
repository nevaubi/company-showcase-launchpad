import { motion } from "motion/react";
import { InkFluid } from "../components/arc/ink-fluid/ink-fluid";
import { ActionLink, type HeroAction } from "../components/arc/blocks/hero-section/hero-content";
import { heroGroup, heroRise } from "../components/arc/blocks/hero-section/hero-motion";
import shell from "../components/arc/blocks/hero-section/hero-section.module.css";
import styles from "./heroes.module.css";

export interface FiledUnderInkHeroProps {
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  className?: string;
}

/**
 * Centered hero over a live ink simulation. The ink drifts on its own and swirls where the visitor moves the pointer;
 * it falls back to a plain surface without WebGL2. The coverage strip under the actions names what FiledUnder reads.
 */
export function FiledUnderInkHero({
  primaryAction = { label: "Start free", doneLabel: "Workspace created" },
  secondaryAction = { label: "See a sample memo", doneLabel: "Opening the memo" },
  className,
}: FiledUnderInkHeroProps) {
  return <section className={[shell.hero, styles.frame, className].filter(Boolean).join(" ")} aria-labelledby="ink-hero-title">
    <InkFluid className={styles.ink} intensity={.42} tint={.75} force={.55} quality="medium">
      <motion.div className={styles.center} variants={heroGroup} initial="hidden" animate="shown">
        <motion.h1 id="ink-hero-title" variants={heroRise} className={[shell.title, styles.inkTitle].join(" ")}>Equity research, written from the filings</motion.h1>
        <motion.p variants={heroRise} className={[shell.description, styles.lede].join(" ")}>
          FiledUnder reads 8-Ks, 10-Qs and earnings calls as they land, then drafts the memo your team would have written, with a citation on every number.
        </motion.p>
        <motion.div variants={heroRise} className={styles.actions}>
          <ActionLink action={primaryAction} kind="primary" />
          <ActionLink action={secondaryAction} kind="secondary" />
        </motion.div>
        <motion.ul variants={heroRise} className={styles.strip} aria-label="What FiledUnder produces">
          <li><strong>Earnings recaps</strong><span>Drafted the day of the filing</span></li>
          <li><strong>Quarterly models</strong><span>Rebuilt from the supplements</span></li>
          <li><strong>Cited answers</strong><span>Linked to the source page</span></li>
        </motion.ul>
      </motion.div>
    </InkFluid>
  </section>;
}

export default FiledUnderInkHero;
