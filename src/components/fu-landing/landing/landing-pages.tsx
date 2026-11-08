import { ChicagoNightVideoHero } from "./hero-video";
import { nightCopyVariants } from "./hero-night-copy";
import { clips } from "./video-clips";
import { ProvenanceSection } from "./provenance-demo";
import { FiledUnderAgentSections } from "./filed-under-agent-sections";
import {
  AccuracyPipeline, Faq, Section, SectionHead, SiteFooter, SiteNav, SourcesStrip, VerificationLedger, VideoCta,
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

