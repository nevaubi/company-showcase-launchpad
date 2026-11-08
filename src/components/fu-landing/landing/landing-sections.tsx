import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import {
  ArrowRight, BookOpenCheck, Briefcase, Check, ChevronDown, Database, FileSearch, FileText, FolderOpen,
  CalendarDays, GitCompareArrows, History, LineChart, Link2, Loader2, Mail, Mic, Presentation, ScrollText, ShieldCheck, Users,
} from "lucide-react";
import { VideoBackdrop, type VideoClip } from "./video-backdrop";
import styles from "./landing.module.css";

/* ------------------------------------------------------------------ */
/* Nav                                                                 */
/* ------------------------------------------------------------------ */

export function Wordmark() {
  return (
    <a href="#top" className={styles.wordmark} aria-label="FiledUnder home">
      <span className={styles.wordmarkIcon}><FolderOpen size={18} strokeWidth={1.9} aria-hidden="true" /></span>
      FiledUnder
    </a>
  );
}

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: "#provenance", label: "Provenance" },
    { href: "#how", label: "How it works" },
    { href: "#verification", label: "Verification" },
    { href: "#product", label: "Product" },
    { href: "#faq", label: "FAQ" },
  ];
  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <Wordmark />
        <nav aria-label="Primary" className={styles.navLinks}>
          {links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </nav>
        <div className={styles.navActions}>
          <a href="/auth" className={styles.navGhost}>Sign in</a>
          <a href="/auth" className={styles.navCta}>Join waitlist</a>
          <button type="button" className={styles.navToggle} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
            <span className={styles.srOnly}>Menu</span>
            <ChevronDown size={18} aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className={styles.mobileNav}>
          {links.map((l) => <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>)}
          <a href="/auth" onClick={() => setOpen(false)}>Sign in</a>
        </nav>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Section shell                                                       */
/* ------------------------------------------------------------------ */

export function SectionHead({ eyebrow, title, body, align = "left" }: { eyebrow: string; title: string; body?: string; align?: "left" | "center" }) {
  return (
    <div className={styles.head} data-align={align}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 className={styles.h2}>{title}</h2>
      {body && <p className={styles.body}>{body}</p>}
    </div>
  );
}

export function Section({ id, children, tone = "plain" }: { id?: string; children: ReactNode; tone?: "plain" | "sunken" }) {
  return (
    <section id={id} className={styles.section} data-tone={tone}>
      <div className={styles.container}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sources strip                                                       */
/* ------------------------------------------------------------------ */

const sourceGroups = [
  {
    name: "SEC filings",
    items: [
      { icon: Database, label: "SEC EDGAR" },
      { icon: FileText, label: "10-K, 10-Q, 8-K" },
      { icon: LineChart, label: "XBRL financial data" },
      { icon: Users, label: "Proxy and Form 4" },
    ],
  },
  {
    name: "Investor relations",
    items: [
      { icon: ScrollText, label: "Earnings releases and supplements" },
      { icon: Presentation, label: "Investor presentations" },
      { icon: Mic, label: "Earnings call transcripts and webcasts" },
      { icon: Mail, label: "Shareholder letters" },
      { icon: CalendarDays, label: "Investor day materials" },
    ],
  },
];

export function SourcesStrip({ label = "Built only on primary sources" }: { label?: string }) {
  return (
    <div className={styles.sources}>
      <div className={styles.container}>
        <p className={styles.sourcesLabel}>{label}</p>
        <div className={styles.sourceGroups}>
          {sourceGroups.map((g) => (
            <div key={g.name} className={styles.sourceGroup}>
              <span className={styles.sourceGroupName}>{g.name}</span>
              <ul className={styles.sourcesList}>
                {g.items.map(({ icon: Icon, label: l }) => (
                  <li key={l}><Icon size={16} aria-hidden="true" />{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accuracy pipeline                                                   */
/* ------------------------------------------------------------------ */

const steps = [
  {
    key: "backfill",
    icon: History,
    title: "Backfill",
    body: "Every 10-K, 10-Q and 8-K for each covered company is parsed into one continuous quarterly history. No gaps, no sampled years.",
  },
  {
    key: "reconcile",
    icon: GitCompareArrows,
    title: "Reconcile",
    body: "Segments must sum to the consolidated total, quarters to the fiscal year, and XBRL facts to the tables in the filing. Anything that doesn't tie is held back.",
  },
  {
    key: "maintain",
    icon: ShieldCheck,
    title: "Maintain",
    body: "When a company restates or reclassifies, the affected history is rewritten and the change is logged against the filing that caused it.",
  },
  {
    key: "cite",
    icon: Link2,
    title: "Cite",
    body: "Every figure carries its source: the filing, the exhibit and the page. One click opens the line it came from.",
  },
] as const;

const backfillYears = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
const reconcileRules = [
  "Σ segment net income = consolidated net income",
  "Q1 + Q2 + Q3 + Q4 = fiscal year",
  "XBRL fact = value in rendered table",
  "Diluted EPS × diluted shares ≈ net income to common",
];

function StepDetail({ step }: { step: (typeof steps)[number]["key"] }) {
  if (step === "backfill") {
    return (
      <div className={styles.detail}>
        <p className={styles.detailLabel}>Filing history, one company</p>
        <div className={styles.years}>
          {backfillYears.map((y, i) => (
            <div key={y} className={styles.yearRow}>
              <span>{y}</span>
              <div className={styles.yearBar}>
                {[0, 1, 2, 3].map((q) => (
                  <motion.i
                    key={q}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: i * 0.08 + q * 0.03, duration: 0.35, ease: "easeOut" }}
                  />
                ))}
              </div>
              <motion.em initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.08 + 0.3 }}>
                <Check size={12} aria-hidden="true" /> 4/4
              </motion.em>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (step === "reconcile") {
    return (
      <div className={styles.detail}>
        <p className={styles.detailLabel}>Rules every quarter must pass</p>
        <ul className={styles.rules}>
          {reconcileRules.map((r, i) => (
            <motion.li key={r} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.18 }}>
              <code>{r}</code>
              <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.18 + 0.35 }}>
                <Check size={13} aria-hidden="true" /> ties
              </motion.span>
            </motion.li>
          ))}
        </ul>
      </div>
    );
  }
  if (step === "maintain") {
    return (
      <div className={styles.detail}>
        <p className={styles.detailLabel}>Change log (example)</p>
        <ol className={styles.log}>
          <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
            <b>New 10-Q received</b>
            <span>Prior-period segment figures recast by the company</span>
          </motion.li>
          <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
            <b>History rewritten</b>
            <span>Recast values applied to every affected quarter</span>
          </motion.li>
          <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
            <b>Checks re-run</b>
            <span>All reconciliation rules pass on the new history</span>
          </motion.li>
          <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
            <b>Logged</b>
            <span>Each change points back to the filing that caused it</span>
          </motion.li>
        </ol>
      </div>
    );
  }
  return (
    <div className={styles.detail}>
      <p className={styles.detailLabel}>Any number, opened</p>
      <div className={styles.citeDemo}>
        <p>
          Net income was <mark>$6,933M<sup>1</sup></mark> in 3Q26, down from <mark>$8,332M<sup>2</sup></mark> a year earlier, while net interest income rose to <mark>$16,449M<sup>3</sup></mark>.
        </p>
        <motion.div className={styles.citeCard} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <FileSearch size={16} aria-hidden="true" />
          <div>
            <b>Bank of America, Form 8-K, Exhibit 99.3</b>
            <span>3Q26 financial supplement · Consolidated income statement</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export function AccuracyPipeline({ id = "how" }: { id?: string }) {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });

  useEffect(() => {
    if (!auto || !inView) return;
    const t = window.setInterval(() => setActive((a) => (a + 1) % steps.length), 4200);
    return () => window.clearInterval(t);
  }, [auto, inView]);

  return (
    <Section id={id}>
      <SectionHead
        eyebrow="How accuracy is kept"
        title="Backfilled, reconciled, maintained and cited"
        body="Most research tools stop at extraction. FiledUnder keeps working on the data after it lands, so the history you read today still ties out after the next filing."
      />
      <div ref={ref} className={styles.pipeline}>
        <div className={styles.stepList} role="tablist" aria-label="Accuracy steps">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const selected = i === active;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                id={`step-${s.key}`}
                aria-selected={selected}
                aria-controls="step-panel"
                className={styles.step}
                onClick={() => { setActive(i); setAuto(false); }}
              >
                <span className={styles.stepIcon}><Icon size={18} aria-hidden="true" /></span>
                <span className={styles.stepText}>
                  <b><span className={styles.stepNum}>0{i + 1}</span>{s.title}</b>
                  <span>{s.body}</span>
                </span>
                {selected && auto && <motion.i className={styles.stepProgress} key={`p-${i}`} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 4.2, ease: "linear" }} />}
              </button>
            );
          })}
        </div>
        <div id="step-panel" role="tabpanel" aria-labelledby={`step-${steps[active].key}`} className={styles.stepPanel}>
          <AnimatePresence mode="wait">
            <motion.div key={steps[active].key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
              <StepDetail step={steps[active].key} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Verification ledger                                                 */
/* ------------------------------------------------------------------ */

// Bank of America 3Q26, values from the 8-K Exhibit 99.3 financial supplement ($ in millions unless noted).
const ledgerRows = [
  { metric: "Net income", value: "$6,933", a: "Supplement", b: "XBRL" },
  { metric: "Diluted EPS", value: "$0.91", a: "Supplement", b: "Press release" },
  { metric: "Net interest income", value: "$16,449", a: "Supplement", b: "Segment sum" },
  { metric: "Noninterest income", value: "$13,509", a: "Supplement", b: "XBRL" },
  { metric: "Consumer Banking net income", value: "$3,521", a: "Segment page", b: "Consolidated tie-out" },
  { metric: "GWIM net income", value: "$1,540", a: "Segment page", b: "Consolidated tie-out" },
  { metric: "Card net charge-off rate", value: "3.22%", a: "Supplement", b: "Credit quality page" },
  { metric: "Efficiency ratio", value: "65.83%", a: "Supplement", b: "Expense ÷ revenue" },
];

export function VerificationLedger({ id = "verification" }: { id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (done >= ledgerRows.length) {
      const reset = window.setTimeout(() => setDone(0), 5000);
      return () => window.clearTimeout(reset);
    }
    const t = window.setTimeout(() => setDone((d) => d + 1), done === 0 ? 500 : 650);
    return () => window.clearTimeout(t);
  }, [inView, done]);

  return (
    <Section id={id} tone="sunken">
      <div className={styles.ledgerWrap}>
        <SectionHead
          eyebrow="Endless accuracy checks"
          title="Every number is checked against a second source before you see it"
          body="Each value is compared with an independent figure in the same filing: the XBRL fact, the segment pages or the arithmetic it has to satisfy. Checks run again on every new release."
        />
        <div ref={ref} className={styles.ledger} aria-label="Verification run, Bank of America 3Q26">
          <div className={styles.ledgerHead}>
            <span><b>BAC</b> 3Q26 · 8-K Ex. 99.3</span>
            <span className={styles.ledgerCount} aria-live="polite">{Math.min(done, ledgerRows.length)}/{ledgerRows.length} verified</span>
          </div>
          <div className={styles.ledgerTable} role="table">
            <div role="row" className={styles.ledgerRowHead}>
              <span role="columnheader">Metric</span>
              <span role="columnheader">Value</span>
              <span role="columnheader">Checked against</span>
              <span role="columnheader">Status</span>
            </div>
            {ledgerRows.map((r, i) => {
              const state = i < done ? "ok" : i === done ? "run" : "wait";
              return (
                <div role="row" key={r.metric} className={styles.ledgerRow} data-state={state}>
                  <span role="cell">{r.metric}</span>
                  <span role="cell" className={styles.num}>{r.value}</span>
                  <span role="cell" className={styles.pair}>{r.a} <ArrowRight size={12} aria-hidden="true" /> {r.b}</span>
                  <span role="cell" className={styles.status}>
                    {state === "ok" && <><Check size={13} aria-hidden="true" /> Verified</>}
                    {state === "run" && <><Loader2 size={13} className={styles.spin} aria-hidden="true" /> Checking</>}
                    {state === "wait" && <>Queued</>}
                  </span>
                </div>
              );
            })}
          </div>
          <p className={styles.ledgerFoot}>$ in millions unless noted. Source: Bank of America 3Q26 financial supplement.</p>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Principles                                                          */
/* ------------------------------------------------------------------ */

const principles = [
  { icon: BookOpenCheck, title: "If we can't source it, we don't say it", body: "Answers are built from filings, not from model memory. A claim without a citation is removed before it reaches you." },
  { icon: History, title: "History stays true", body: "Restatements and reclassifications are applied back through every affected quarter, so trends compare like with like." },
  { icon: GitCompareArrows, title: "Two sources or it waits", body: "A value is published only when a second figure in the filing agrees with it. Disagreements go to review, not to your screen." },
  { icon: Link2, title: "One click to the page", body: "Every number in a memo, chart or answer opens the filing, exhibit and page it came from." },
];

export function Principles({ id }: { id?: string }) {
  return (
    <Section id={id}>
      <SectionHead eyebrow="Our standard" title="Accuracy is the product" align="center" />
      <ul className={styles.principles}>
        {principles.map(({ icon: Icon, title, body }, i) => (
          <motion.li
            key={title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ delay: i * 0.08, duration: 0.5 }}
          >
            <span className={styles.pIcon}><Icon size={18} aria-hidden="true" /></span>
            <b>{title}</b>
            <p>{body}</p>
          </motion.li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Use cases                                                           */
/* ------------------------------------------------------------------ */

const useCases = [
  { icon: LineChart, who: "Equity analysts", body: "Earnings recaps drafted from the supplement the morning of the release, with the model rebuilt and every change from last quarter flagged." },
  { icon: Briefcase, who: "Portfolio managers", body: "Ask across the whole coverage universe and get answers that cite the filing, so a position review never rests on an unchecked number." },
  { icon: Users, who: "IR and corporate development", body: "Benchmark peers on segment-level metrics with consistent, restated histories instead of stitching together old spreadsheets." },
];

export function UseCases({ id }: { id?: string }) {
  return (
    <Section id={id}>
      <SectionHead eyebrow="Who it's for" title="For teams whose numbers get checked" />
      <ul className={styles.useCases}>
        {useCases.map(({ icon: Icon, who, body }) => (
          <li key={who}>
            <Icon size={20} aria-hidden="true" />
            <b>{who}</b>
            <p>{body}</p>
            <a href="/auth">See it on your coverage <ArrowRight size={14} aria-hidden="true" /></a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const faqs = [
  { q: "Where does the data come from?", a: "Only from primary sources: SEC EDGAR filings (10-K, 10-Q, 8-K and exhibits), XBRL financial data, and company investor relations material such as earnings releases, supplements, investor presentations, call transcripts and shareholder letters. No scraped aggregator data." },
  { q: "What does a complete backfill mean?", a: "For each covered company we parse every periodic and current report into one quarterly history, so a trend chart is built from the filings themselves rather than a sample of years." },
  { q: "How do you handle restatements?", a: "When a new filing recasts prior periods, the affected quarters are rewritten, all reconciliation checks run again, and the change is logged against the filing that caused it." },
  { q: "What happens when two sources disagree?", a: "The value is held back and sent to review. It appears only after it ties to a second figure in the filing or the discrepancy is documented." },
  { q: "Can I see where an answer came from?", a: "Yes. Every number in a memo, chart or chat answer links to the filing, exhibit and page. Answers without a source are not shown." },
];

export function Faq({ id = "faq" }: { id?: string }) {
  return (
    <Section id={id}>
      <div className={styles.faqWrap}>
        <SectionHead eyebrow="FAQ" title="Questions about accuracy" body="The short version: primary sources only, checked twice, maintained forever." />
        <div className={styles.faq}>
          {faqs.map((f) => (
            <details key={f.q} className={styles.faqItem}>
              <summary>{f.q}<ChevronDown size={18} aria-hidden="true" /></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Video CTA                                                           */
/* ------------------------------------------------------------------ */

export function VideoCta({ clip, title, body }: { clip: VideoClip; title: string; body: string }) {
  return (
    <section className={styles.ctaSection} aria-labelledby="cta-title">
      <div className={styles.container}>
        <div className={styles.cta}>
          <VideoBackdrop clip={clip} scrim="strong" controlPosition="bottom-right">
            <div className={styles.ctaInner}>
              <h2 id="cta-title" className={styles.ctaTitle}>{title}</h2>
              <p className={styles.ctaBody}>{body}</p>
              <div className={styles.ctaActions}>
                <a href="/auth" className={styles.ctaPrimary}>Join waitlist <ArrowRight size={16} aria-hidden="true" /></a>
                <a href="/auth" className={styles.ctaSecondary}>Book a walkthrough</a>
              </div>
            </div>
          </VideoBackdrop>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export function SiteFooter() {
  const cols = [
    { h: "Product", l: ["Earnings recaps", "Ask the filings", "Quarterly models", "Verification"] },
    { h: "Company", l: ["About", "Careers", "Contact"] },
    { h: "Resources", l: ["Methodology", "Coverage list", "Changelog", "Security"] },
  ];
  return (
    <footer className={styles.footer}>
      <div className={[styles.container, styles.footerGrid].join(" ")}>
        <div className={styles.footerBrand}>
          <Wordmark />
          <p>AI research and analysis for financial markets, grounded in the filings. Built in Chicago.</p>
        </div>
        {cols.map((c) => (
          <nav key={c.h} aria-label={c.h} className={styles.footerCol}>
            <b>{c.h}</b>
            {c.l.map((x) => <a key={x} href={`#${x.toLowerCase().replace(/\s+/g, "-")}`}>{x}</a>)}
          </nav>
        ))}
      </div>
      <div className={[styles.container, styles.footerBase].join(" ")}>
        <span>© 2026 FiledUnder</span>
        <span>Not investment advice. Data from public SEC filings.</span>
      </div>
    </footer>
  );
}
