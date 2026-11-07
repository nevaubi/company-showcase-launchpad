import type { ReactNode } from "react";
import type { SourceCardsMarkId } from "./source-cards-marks";

export interface SourceCardsSource {
  /** Stable key. Defaults to the URL. */
  id?: string;
  /** Page title as the search result shows it. */
  title: string;
  /** Full URL. The host becomes the visible domain and picks the site mark. */
  url: string;
  /** Readable site name for the preview, such as "Stripe Docs". Defaults to the mark's name or the host. */
  site?: string;
  /** The passage the answer relied on, shown in the hover preview. */
  snippet?: string;
  /** Short date label, such as "Oct 9, 2026". */
  published?: string;
  /** Force a known mark. Usually inferred from the URL. */
  mark?: SourceCardsMarkId;
  /** Custom favicon (for example an img of the site's icon) for sites without a built-in mark. */
  icon?: ReactNode;
}

export type SourceCardsStatus = "searching" | "done" | "error";

/** One run of the sample answer: plain text, inline code, or a citation of a 1-based source number. */
export type SourceCardsAnswerToken = string | { code: string } | { cite: number };

export const sourceCardsQuestion = "Why does my Stripe webhook fail signature verification in a Next.js route handler?";
export const sourceCardsQuery = "stripe webhook signature verification next.js route handler";

/** Sample sources, October 2026. Titles and URLs follow the real sites; issue and question numbers are samples. */
export const sourceCardsSamples: SourceCardsSource[] = [
  {
    title: "Check the webhook signatures",
    url: "https://docs.stripe.com/webhooks/signature",
    published: "Oct 9, 2026",
    snippet: "Stripe signs every webhook event it sends by including a signature in the Stripe-Signature header. Verify it with constructEvent, the raw request body and your endpoint's secret before you trust the payload.",
  },
  {
    title: "Request: text() method",
    url: "https://developer.mozilla.org/en-US/docs/Web/API/Request/text",
    published: "Sep 18, 2026",
    snippet: "The text() method of the Request interface reads the request body and returns it as a promise that resolves with a string. The body is always decoded using UTF-8.",
  },
  {
    title: "constructEvent throws \"No signatures found\" in App Router",
    url: "https://github.com/stripe/stripe-node/issues/2241",
    site: "GitHub · stripe/stripe-node",
    published: "Oct 21, 2026",
    snippet: "The body had already been parsed with request.json(), so the string passed to constructEvent no longer matched the signed bytes. Switching to await request.text() fixed it on Next.js 16.",
  },
  {
    title: "Stripe webhook signature verification failed in a Next.js route handler",
    url: "https://stackoverflow.com/questions/79184412/stripe-webhook-signature-verification-failed-nextjs",
    published: "Oct 3, 2026",
    snippet: "Accepted answer: do not parse the body. Read it as text, pass the string and the stripe-signature header to constructEvent, and use the whsec_ secret for this endpoint, not your API key.",
  },
  {
    title: "Handling Stripe webhooks in Vercel Functions",
    url: "https://vercel.com/guides/stripe-webhooks-vercel-functions",
    published: "Aug 27, 2026",
    snippet: "Run the route on the Node.js runtime, read the raw body, verify the event and respond with a 2xx before doing slow work. Queue anything longer so the delivery never times out.",
  },
  {
    title: "HMAC",
    url: "https://en.wikipedia.org/wiki/HMAC",
    published: "Oct 12, 2026",
    snippet: "In cryptography, an HMAC is a specific type of message authentication code involving a cryptographic hash function and a secret cryptographic key. It verifies both the data integrity and the authenticity of a message.",
  },
  {
    title: "Receive Stripe events in your webhook endpoint",
    url: "https://docs.stripe.com/webhooks",
    published: "Oct 9, 2026",
    snippet: "In live mode, Stripe retries undelivered events with exponential backoff for up to three days. Return a successful status code quickly, before any complex logic that could cause a timeout.",
  },
];

/** The sample answer, cited inline. Streams a few words at a time in the self-playing demo. */
export const sourceCardsAnswer: SourceCardsAnswerToken[] = [
  "Stripe signs the exact bytes it sends, so read the raw body with ", { code: "await request.text()" }, " before anything parses it ", { cite: 1 }, { cite: 2 }, ". ",
  "Calling ", { code: "request.json()" }, " first re-serializes the payload, the HMAC no longer matches and ", { code: "constructEvent" }, " throws ", { cite: 3 }, { cite: 4 }, ". ",
  "Pass that string with the ", { code: "stripe-signature" }, " header and the endpoint's ", { code: "whsec_" }, " secret, keep the route on the Node.js runtime and return a 2xx quickly, since Stripe retries failed deliveries for up to three days ", { cite: 5 }, { cite: 7 }, ". ",
  "The signature itself is an HMAC-SHA256 of the timestamp and payload ", { cite: 6 }, ".",
];
