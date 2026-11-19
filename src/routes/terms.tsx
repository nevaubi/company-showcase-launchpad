import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/legal-page";

const TITLE = "Terms of service · FiledUnder";
const DESC = "The terms for using FiledUnder, including research-only use, confidentiality of the platform and acceptable use.";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://filedunder.ai/terms" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://filedunder.ai/terms" }],
  }),
  component: Terms,
});

const SECTIONS = [
  { h: "Who these terms cover", body: <><p>These terms are an agreement between you and FiledUnder ("we", "us") for use of filedunder.ai and the signed-in research platform (the "Service"). If you use the Service for a firm, you confirm you may bind that firm, and "you" includes it.</p><p>You must be at least 18 and able to form a binding contract. By creating an account, accepting these terms in the app or using the Service, you agree to them and to the <Link to="/privacy">privacy policy</Link>.</p></> },
  { h: "Research software, not advice", body: <><p>FiledUnder is research software. It is not a broker-dealer, investment adviser, research analyst or exchange, and nothing in the Service is a recommendation, solicitation or offer to buy or sell any security.</p><p>Signals, setups, autopilots, paper trades, reports, assistant answers and other outputs are for research and education. Historical hit rates and backtests do not predict future results. You alone decide what to do with any information and you are responsible for your own investment decisions and for following the laws and rules that apply to you.</p></> },
  { h: "Data and accuracy", body: <><p>Figures come mostly from public sources such as SEC EDGAR, company investor relations sites, FINRA, FRED and market data providers, and we link values to their sources where we can. Sources can be late, revised or wrong, and automated reading, including AI-assisted reading, can make mistakes. Market data may be delayed.</p><p>Check important figures against the original source before relying on them. The Service is provided "as is" and "as available".</p></> },
  { h: "Accounts and access", body: <><p>Access is by approval. Keep your sign-in details private; each account is for one named person. Do not share an account or resell access. Firm workspaces may only be used by people their admins invite.</p><p>We may suspend or end access that breaks these terms, puts the Service or other users at risk, or is required by law.</p></> },
  { h: "Trials, plans and payment", body: <><p>An approved trial lasts 14 days from the moment you accept these terms in the app. No card is needed and nothing is charged during the trial. Paid access follows a plan or order agreed with us; its price, scope and term are set out there. Your saved work stays after a trial ends.</p></> },
  { h: "Confidentiality of the platform", body: <><p>The Service contains non-public information belonging to FiledUnder: how features work and are built, data structures and coverage, prompts, models and model settings, scoring and signal rules, extraction and matching methods, unreleased features, pricing and any non-public materials or conversations with us ("Confidential Information"). Public filings and data you could get elsewhere are not Confidential Information, and neither is your own content.</p><p>You agree to use Confidential Information only to use the Service for yourself or your firm, not to disclose it to anyone else, and to protect it with at least reasonable care. This duty lasts during your use and for three years after it ends, and for as long as the information remains a trade secret. You may disclose it when the law requires, after telling us where allowed.</p></> },
  { h: "Acceptable use", body: <><p>You will not, and will not help anyone else to:</p><ul><li>copy, scrape, crawl or bulk export the Service or its data beyond the exports it offers, or access it through automated means we have not provided;</li><li>reverse engineer, decompile or try to extract source code, prompts, models or methods;</li><li>use the Service or its outputs to build, train, tune or benchmark a competing product or AI model;</li><li>publish or share comparisons, benchmarks or descriptions of how the Service works without our written permission;</li><li>get around access controls, usage limits or security, or probe for weaknesses;</li><li>upload unlawful content, malware, or material you have no right to use;</li><li>use the Service to break securities laws, including trading on material non-public information.</li></ul></> },
  { h: "Your content", body: <><p>You keep ownership of what you put into the Service, such as notes, theses, documents, uploads and questions. You give us the permission needed to store, process and display it to run the Service for you. We do not sell your content and do not use it to train AI models offered to others.</p><p>Research outputs the Service produces for you may be used for your own or your firm's internal work. Shared links are visible to whoever has them.</p></> },
  { h: "Our property", body: <><p>The Service, its software, design, compiled datasets, derived figures, text and brand belong to FiledUnder or its licensors. Apart from the limited right to use the Service under these terms, no rights are granted. If you send feedback, we may use it without obligation to you.</p></> },
  { h: "Other services", body: <><p>The Service links to and relies on outside sources and providers. We are not responsible for their content or availability, and their own terms may apply when you visit them.</p></> },
  { h: "Disclaimers and limits", body: <><p>To the fullest extent the law allows, we disclaim all warranties, express or implied, including fitness for a purpose, accuracy and non-infringement. We are not liable for trading or investment losses, lost profits or indirect, incidental or consequential damages. Our total liability for any claim is limited to the greater of the amount you paid us in the 12 months before the claim and 100 US dollars.</p><p>Some places do not allow these limits, so they apply only as far as the law permits.</p></> },
  { h: "Indemnity", body: <p>You will cover our reasonable costs from claims by others that arise from your breach of these terms or your misuse of the Service, including trading decisions made with it.</p> },
  { h: "Ending use", body: <p>You may stop using the Service at any time and ask us to delete your account. Sections on confidentiality, acceptable use, our property, disclaimers, limits, indemnity and law survive the end of your use.</p> },
  { h: "Changes", body: <p>We may update these terms. We will change the date above and, for material changes, tell signed-in users in the app or by email before they take effect. Continuing to use the Service after that means you accept the update.</p> },
  { h: "Law and disputes", body: <p>These terms are governed by the laws of the State of Illinois, USA, without regard to its conflict of law rules. Disputes go to the state and federal courts in Cook County, Illinois, and both sides consent to those courts. Either side may seek urgent relief anywhere to protect confidential information or intellectual property.</p> },
  { h: "General", body: <p>If part of these terms cannot be enforced, the rest still applies. Not enforcing a term is not a waiver. You may not transfer these terms without our consent. These terms, the privacy policy and any order you sign with us are the whole agreement on this subject; a signed order wins where they conflict.</p> },
];

function Terms() {
  return <LegalPage title="Terms of service" intro={<p>Please read these terms before using FiledUnder. The short version: it is a research tool, not advice; check figures at their source; keep what you learn about how the platform works confidential; and do not scrape or copy it.</p>} sections={SECTIONS} />;
}
