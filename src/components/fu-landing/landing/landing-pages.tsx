import { ChicagoNightVideoHero, ChicagoSplitVideoHero, MarketsVideoHero, type MarketsHeroCopy, type SplitHeroCopy } from "./hero-video";
import { nightCopyVariants } from "./hero-night-copy";
import { clips } from "./video-clips";
import { ProvenanceSection } from "./provenance-demo";
import { FiledUnderAgentSections } from "./filed-under-agent-sections";
import {
  AccuracyPipeline, Faq, Principles, Section, SectionHead, SiteFooter, SiteNav, SourcesStrip, UseCases,
  VerificationLedger, VideoCta,
} from "./landing-sections";
import styles from "./landing.module.css";

function Product({ id = "product", tone = "plain" as const }: { id?: string; tone?: "plain" | "sunken" }) {
  return (
    <Section id={id} tone={tone}>
      <div className={styles.productIntro}>
        <SectionHead
          eyebrow="The product"
          title="Research that does the reading for you"
          body="Every workflow runs on the same verified history, so the memo and the model agree with the filing and with each other."
        />
      </div>
      <FiledUnderAgentSections />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Version 1: Verification-first. Night aerial hero, method up front.  */
/* ------------------------------------------------------------------ */

export function LandingVerification() {
  return (
    <div className={styles.page} id="top">
      <SiteNav />
      <main>
        <div className={styles.heroWrap}>
          <ChicagoNightVideoHero copy={{ ...nightCopyVariants[0].copy, proof: [] }} id="v1-hero-title" />
        </div>
        <SourcesStrip />
        <ProvenanceSection />
        <AccuracyPipeline />
        <VerificationLedger />
        <Product />
        <Faq />
        <VideoCta
          clip={clips.lakefront}
          title="Stop checking the numbers. Start using them."
          body="Every figure backfilled, reconciled and cited before it reaches you. Try it on your own coverage."
        />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Version 2: Markets desk. Terminal hero, product demos first.        */
/* ------------------------------------------------------------------ */

const marketsCopy: MarketsHeroCopy = {
  eyebrow: "AI research and analysis for financial markets",
  title: "Market intelligence you can audit",
  lede: "FiledUnder turns every release, supplement and call into cited analysis, built on a fully backfilled history that is re-checked with every filing.",
};

export function LandingMarkets() {
  return (
    <div className={styles.page} id="top">
      <SiteNav />
      <main>
        <div className={styles.heroWrap}>
          <MarketsVideoHero copy={marketsCopy} secondaryAction={{ label: "See how we verify", href: "#verification" }} />
        </div>
        <SourcesStrip label="Every answer traces back to one of these" />
        <Product />
        <VerificationLedger />
        <UseCases />
        <VideoCta
          clip={clips.nightAerial}
          title="The most intelligent research desk never sleeps"
          body="New filings are read, reconciled and folded into your coverage the minute they post."
        />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Version 3: Editorial. Split hero, principles and method.            */
/* ------------------------------------------------------------------ */

const splitCopy: SplitHeroCopy = {
  eyebrow: "Source-grounded financial research",
  title: "Every number sourced. Every filing checked.",
  lede: "The most intelligent AI for financial markets research, built on a complete filing history that is maintained as companies report and audited with every update.",
  facts: [
    { label: "History", value: "Fully backfilled" },
    { label: "Checks", value: "Every filing" },
    { label: "Citations", value: "Every number" },
  ],
};

export function LandingEditorial() {
  return (
    <div className={styles.page} id="top">
      <SiteNav />
      <main>
        <div className={styles.heroWrap}>
          <ChicagoSplitVideoHero copy={splitCopy} />
        </div>
        <SourcesStrip />
        <Principles />
        <AccuracyPipeline />
        <VerificationLedger />
        <UseCases id="product" />
        <Faq />
        <VideoCta
          clip={clips.riverDusk}
          title="Research you never have to double-check"
          body="Primary sources only, two checks on every value, maintained for as long as you cover the name."
        />
      </main>
      <SiteFooter />
    </div>
  );
}

export const landingVersions = [
  { key: "verification", name: "1 · Verification", Component: LandingVerification },
  { key: "markets", name: "2 · Markets desk", Component: LandingMarkets },
  { key: "editorial", name: "3 · Editorial", Component: LandingEditorial },
] as const;
