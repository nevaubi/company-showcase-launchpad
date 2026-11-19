import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/legal-page";

const TITLE = "Privacy policy · FiledUnder";
const DESC = "What FiledUnder collects, why, who processes it for us, how long we keep it and the choices you have.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://filedunder.ai/privacy" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://filedunder.ai/privacy" }],
  }),
  component: Privacy,
});

const SECTIONS = [
  { h: "What we collect", body: <><ul><li><b>Waitlist and account details:</b> name, work email, and optionally firm, role and what you want to use FiledUnder for; your sign-in method and profile picture if you sign in with Google.</li><li><b>Your work in the app:</b> watchlists, theses, notes, documents and files you create or upload, assistant conversations, saved views, paper trades and settings.</li><li><b>Firm workspaces:</b> membership, roles, invites and branding your firm sets.</li><li><b>Usage and security records:</b> usage counts for plan limits, the emails we sent you, and a one-way hashed form of your IP address used to stop waitlist abuse.</li><li><b>Payments:</b> if you pay, our payment processor handles your card; we receive the plan, status and billing contact, not card numbers.</li></ul></> },
  { h: "How we use it", body: <ul><li>to review access requests, run your account and deliver the features you use;</li><li>to send emails about your request, approval, sign-in reminder, firm invites and the account;</li><li>to keep the Service secure, enforce limits and the <Link to="/terms">terms</Link>, and fix problems;</li><li>to understand, in aggregate, how the site is used so we can improve it;</li><li>to meet legal obligations.</li></ul> },
  { h: "Research questions and AI", body: <><p>When you use the research assistant or other AI features, your question and the relevant data are sent to AI model providers to produce the answer. They process it for us under their terms. We do not sell your inputs and do not use them to train models offered to others.</p><p>Some public documents such as company filings are read by AI providers to build our datasets; your own files and chats are not sent through that bulk reading.</p></> },
  { h: "Who processes data for us", body: <><p>We use service providers who act on our instructions: hosting, database, sign-in and file storage (Lovable Cloud), email delivery (Lovable Email), AI model providers, web search and page reading providers used when you ask for web research, a cloud browser provider when you start a browser run, document editing servers for Office files, and a payment processor. Google handles sign-in if you choose it.</p><p>We do not sell personal information and do not share it for cross-site advertising. We may disclose information if the law requires it, to protect rights and safety, or as part of a merger or sale with notice to you.</p></> },
  { h: "Visitor analytics", body: <><p>The public site uses Lovable's visitor analytics. It uses no cookies, stores nothing on your device, doesn't keep IP addresses and doesn't identify visitors. Lovable collects this data for us. <a href="https://lovable.dev/privacy" target="_blank" rel="noreferrer">Lovable's privacy policy</a> explains how it handles it.</p><p>It records the pages visited, where visitors came from, their country, browser, operating system and device type, how long they stay, how fast pages load, errors, and which buttons and links are clicked. All of this is recorded for every visitor. Detailed data is kept for 90 days and daily summaries for a year.</p></> },
  { h: "Cookies and device storage", body: <p>We store your sign-in session and preferences such as theme and layout in your browser so you stay signed in and the app looks the way you set it. We do not use advertising cookies or pixels.</p> },
  { h: "How long we keep it", body: <p>Account data and your work are kept while your account is open. Waitlist requests are kept while access is under review and for a reasonable time after. Email records and security logs are kept as long as needed for delivery, abuse prevention and audit. When you ask us to delete your account we delete or anonymise your personal data within 30 days, except what we must keep by law.</p> },
  { h: "Security", body: <p>Data is encrypted in transit, private files are stored in access-controlled storage, and database rules limit each person to their own data and their firm's shared data. No system is perfectly secure; tell us at once if you suspect misuse of your account.</p> },
  { h: "Your choices and rights", body: <p>You can view and edit most of your data in the app. You can ask us for a copy, a correction or deletion, or object to some processing, by emailing <a href="mailto:admin@filedunder.ai">admin@filedunder.ai</a>. Depending on where you live, including California and the European Economic Area, you may have further rights under local law, and you may complain to a data protection authority. We will not treat you differently for using these rights.</p> },
  { h: "International transfers", body: <p>We are based in the United States and our providers may process data in the United States and other countries. Where required, transfers rely on appropriate safeguards.</p> },
  { h: "Children", body: <p>The Service is for professionals and is not directed to anyone under 18. We do not knowingly collect their data.</p> },
  { h: "Changes", body: <p>We may update this policy and will change the date above. For material changes we will tell signed-in users in the app or by email.</p> },
];

function Privacy() {
  return <LegalPage title="Privacy policy" intro={<p>This policy explains what FiledUnder collects when you visit the site, join the waitlist or use the app, why we collect it and the choices you have. It applies alongside our <Link to="/terms">terms of service</Link>.</p>} sections={SECTIONS} />;
}
