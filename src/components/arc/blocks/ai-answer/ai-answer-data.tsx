/*
 * Sample content for the AI answer block: a practical question about rolling out passkeys, its sources and three follow-ups.
 * The answers are written for the demo and kept to well established WebAuthn practice. Source dates are sample values.
 */
import type { ReactNode } from "react";
import { AppleMark, Auth0Mark, ClaudeMark, GithubMark, GoogleColorMark, MdnwebdocsMark, OktaMark, OnePasswordMark, WikipediaMark } from "./ai-answer-marks";

/* ---------------------------------------------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------------------------------------------- */

/** Inline text in paragraphs, headings, list items and table cells supports **bold**, `code` and [n] citations. */
export type AnswerBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "code"; code: string; language?: string; filename?: string };

export interface AnswerSource {
  /** Stable key. Citations use the source's position in the list: [1] is the first source. */
  id: string;
  title: string;
  /** Publisher name, such as "MDN Web Docs". */
  site: string;
  domain: string;
  url: string;
  /** Display date, such as "Sep 18, 2026". */
  date?: string;
  /** One or two sentences shown in the citation card. */
  snippet?: string;
  /** The site's mark, about 16px. Color brands keep their fills; mono marks draw with currentColor. Without one, the domain's first letter stands in. */
  icon?: ReactNode;
}

export interface AnswerModel {
  id: string;
  name: string;
  mark?: ReactNode;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Models
 * ------------------------------------------------------------------------------------------------------------- */

const claude = <ClaudeMark aria-hidden="true" style={{ color: "#D97757" }} />;
export const defaultModels: AnswerModel[] = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", mark: claude },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", mark: claude },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", mark: claude },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", mark: claude },
];

/* ---------------------------------------------------------------------------------------------------------------
 * Sources
 * ------------------------------------------------------------------------------------------------------------- */

const pool = {
  webdev: { id: "webdev", title: "Sign in with a passkey through form autofill", site: "web.dev", domain: "web.dev", url: "https://web.dev/articles/passkey-form-autofill", date: "Sep 24, 2026", icon: <GoogleColorMark aria-hidden="true" />, snippet: "Conditional mediation lists passkeys in the browser's autofill menu next to saved passwords, when the username field has autocomplete=\"username webauthn\"." },
  mdn: { id: "mdn", title: "Web Authentication API", site: "MDN Web Docs", domain: "developer.mozilla.org", url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API", date: "Oct 2, 2026", icon: <MdnwebdocsMark aria-hidden="true" />, snippet: "Reference for navigator.credentials.create() and get(), the options they take, and the public key credential your server verifies." },
  apple: { id: "apple", title: "Passkeys", site: "Apple Developer", domain: "developer.apple.com", url: "https://developer.apple.com/passkeys/", date: "Sep 15, 2026", icon: <AppleMark aria-hidden="true" />, snippet: "Passkeys sync through iCloud Keychain with end-to-end encryption, so they are ready on a person's other Apple devices." },
  github: { id: "github", title: "About passkeys", site: "GitHub Docs", domain: "docs.github.com", url: "https://docs.github.com/en/authentication/authenticating-with-a-passkey/about-passkeys", date: "Aug 28, 2026", icon: <GithubMark aria-hidden="true" />, snippet: "Passkeys sit next to a password and two-factor authentication, and can be reviewed, renamed or removed from account settings." },
  onepassword: { id: "onepassword", title: "Save and sign in with passkeys", site: "1Password", domain: "1password.com", url: "https://1password.com/product/passkeys", date: "Sep 9, 2026", icon: <OnePasswordMark aria-hidden="true" style={{ color: "#145FE4" }} />, snippet: "Passkeys saved in a password manager sync to a person's other devices and browsers, alongside their passwords." },
  okta: { id: "okta", title: "Configure the FIDO2 (WebAuthn) authenticator", site: "Okta", domain: "help.okta.com", url: "https://help.okta.com/oie/en-us/content/topics/identity-engine/authenticators/configure-webauthn.htm", date: "Jul 30, 2026", icon: <OktaMark aria-hidden="true" style={{ color: "#007DC1" }} />, snippet: "Admins can require specific authenticator types, such as hardware security keys, in sign-in policies for chosen groups." },
  auth0: { id: "auth0", title: "Passkeys", site: "Auth0 Docs", domain: "auth0.com", url: "https://auth0.com/docs/authenticate/database-connections/passkeys", date: "Sep 3, 2026", icon: <Auth0Mark aria-hidden="true" style={{ color: "#EB5424" }} />, snippet: "Progressive enrollment offers a passkey after a successful sign-in, while password sign-in stays available." },
  wikipedia: { id: "wikipedia", title: "WebAuthn", site: "Wikipedia", domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/WebAuthn", date: "Oct 11, 2026", icon: <WikipediaMark aria-hidden="true" />, snippet: "WebAuthn is a W3C standard, part of FIDO2, for signing in with public key cryptography instead of a shared secret." },
} satisfies Record<string, AnswerSource>;

/* ---------------------------------------------------------------------------------------------------------------
 * Scripts
 * ------------------------------------------------------------------------------------------------------------- */

export interface AnswerScript {
  question: string;
  reasoning: string;
  sources: AnswerSource[];
  blocks: AnswerBlock[];
  /** A different opening paragraph, used by Try again and Switch model. */
  altLead: string;
  /** Appended by More detailed. */
  extra: AnswerBlock[];
  /** Reported by the simulated model: seconds of thinking. */
  thought: number;
}

const rollout: AnswerScript = {
  question: "How do we roll out passkeys without locking anyone out?",
  thought: 9,
  reasoning: "The risk in a passkey rollout is rarely the passkey itself. It is removing the old way in before people have a reliable new one, so the plan should be additive: passkeys next to passwords, created right after a verified sign-in, offered through autofill so nobody has to find a new button.\n\nTwo places can strand an account: a device-bound passkey with no backup, and turning passwords off too early. I'll stage the rollout, compare synced and device-bound passkeys, and show the autofill call.",
  sources: [pool.webdev, pool.mdn, pool.onepassword, pool.apple, pool.auth0, pool.github, pool.okta, pool.wikipedia],
  blocks: [
    { type: "paragraph", text: "Add passkeys next to your current sign-in instead of replacing it. Offer one right after someone has proven who they are, which is how progressive enrollment works in most identity platforms. [5] Let the browser surface passkeys through autofill, so nobody has to learn a new button. [1] Only make passwords optional once an account has a reliable second way in." },
    { type: "heading", text: "Roll it out in four stages" },
    { type: "list", ordered: true, items: [
      "**Offer, don't force.** Prompt for a passkey after a successful sign-in or password reset, while the session is fresh. Keep passwords and existing two-factor methods working. [6]",
      "**Sign in through autofill.** Request credentials with `mediation: \"conditional\"` so saved passkeys appear in the username field's suggestions. [1][2] People without one simply see their passwords.",
      "**Make them manageable.** List each passkey in account settings with where it was created and when it was last used, and let people add a backup or remove a lost device. [6]",
      "**Retire passwords last.** Offer to remove a password only when the account has a synced passkey or two registered credentials. [4] Keep a recovery path through a verified email or support.",
    ] },
    { type: "heading", text: "Synced or device-bound" },
    { type: "paragraph", text: "Passkeys are WebAuthn credentials, and they come in two kinds. [8] Most people will create synced passkeys, stored in their platform account or password manager. [3][4] Policies can still require device-bound keys for high-risk accounts. [7]" },
    { type: "table", columns: ["", "Synced", "Device-bound"], rows: [
      ["Stored in", "Platform account or password manager", "One security key or device"],
      ["Lost phone", "Restores on the next device", "Needs a registered backup"],
      ["Best for", "Most customer and staff accounts", "Admins and high-risk roles"],
      ["Attestation", "Usually not available", "Available for policy checks"],
    ] },
    { type: "heading", text: "Turn on autofill sign-in" },
    { type: "paragraph", text: "Mark the username field with `autocomplete=\"username webauthn\"`, then start a conditional request when the page loads. [1]" },
    { type: "code", language: "js", filename: "sign-in.js", code: "// Passkeys appear in the username field's autofill menu.\nif (await PublicKeyCredential.isConditionalMediationAvailable?.()) {\n  const credential = await navigator.credentials.get({\n    mediation: \"conditional\",\n    publicKey: { challenge, rpId: \"example.com\", userVerification: \"preferred\" },\n  });\n  await verifyOnServer(credential);\n}" },
    { type: "paragraph", text: "Before each stage, watch passkey sign-in success and recovery requests. If recovery requests rise, pause and fix the flow before moving on." },
  ],
  altLead: "Treat passkeys as an extra way in until the numbers say otherwise. Enroll people right after a verified sign-in, where most identity platforms already prompt. [5] Surface passkeys in the username autofill menu so the sign-in page barely changes. [1] Keep passwords working until an account has a second reliable credential.",
  extra: [
    { type: "heading", text: "Communicate each stage" },
    { type: "list", items: [
      "Explain the benefit in one line at the prompt: faster sign-in, nothing to remember.",
      "Tell people where their passkey is saved, such as their phone or password manager. [3]",
      "Send a notice to every verified email when a passkey is added or removed. [6]",
    ] },
  ],
};

const recovery: AnswerScript = {
  question: "How should account recovery work once passwords are optional?",
  thought: 6,
  reasoning: "Recovery is where passkey rollouts tend to fail, because the fallback becomes the weakest way in. The answer should keep recovery as strong as sign-in: verified channels, a short delay for risky changes, and a fresh passkey at the end instead of a temporary password.",
  sources: [pool.github, pool.apple, pool.okta, pool.auth0],
  blocks: [
    { type: "paragraph", text: "Recovery should be as hard to abuse as sign-in, or attackers will go through it instead. Most people never need it, because synced passkeys come back with their platform account on a new device. [2]" },
    { type: "heading", text: "A recovery flow that holds up" },
    { type: "list", ordered: true, items: [
      "**Start with what still works.** Offer a second passkey or a security key first, then a link to a verified email.",
      "**Delay risky changes.** Hold a passkey added through recovery for a few hours and notify every verified channel, so the owner can cancel.",
      "**Give admins a reset, not a bypass.** In workforce tools, an admin clears the credentials and the person enrolls again at next sign-in. [3]",
      "**Offer recovery codes to people who want them.** Show them once, store only hashes, and let people generate a new set. [1]",
    ] },
    { type: "paragraph", text: "End every recovery with a new passkey, so the person leaves with a working credential instead of a temporary password. [4]" },
  ],
  altLead: "Design recovery as a second sign-in path with the same strength as the first. People with synced passkeys rarely need it, since their passkeys return with their platform account. [2]",
  extra: [
    { type: "heading", text: "What to log" },
    { type: "list", items: [
      "Every recovery attempt, its channel and its result.",
      "Passkeys added within a day of a recovery, flagged for review.",
      "Support resets, with the agent and the reason.",
    ] },
  ],
};

const metrics: AnswerScript = {
  question: "What should we measure before each rollout stage?",
  thought: 7,
  reasoning: "Enrollment alone is a vanity number here. The useful signals show whether people actually get in with a passkey, whether they fall back to passwords, and whether recovery load moves. A small table of signals plus explicit gates between stages answers it.",
  sources: [pool.webdev, pool.mdn, pool.auth0],
  blocks: [
    { type: "paragraph", text: "Measure whether people get in, not just whether they enroll. A rising enrollment number can hide people who fall back to passwords or get stuck in recovery." },
    { type: "heading", text: "Signals to track" },
    { type: "table", columns: ["Signal", "What it tells you", "Healthy trend"], rows: [
      ["Enrollment", "Active accounts with a passkey", "Rising weekly"],
      ["Passkey success", "Passkey attempts that complete", "Above password success"],
      ["Fallbacks", "Passkey offered, password used", "Falling"],
      ["Recovery", "Lockouts per 1,000 sign-ins", "Flat or falling"],
    ] },
    { type: "paragraph", text: "Record the credential type on every sign-in event. The returned credential's `authenticatorAttachment` tells you whether the passkey came from this device or another one. [2]" },
    { type: "code", language: "js", filename: "track-sign-in.js", code: "// One event per passkey sign-in attempt\nanalytics.track(\"passkey_sign_in\", {\n  result: verified ? \"success\" : \"failed\",\n  attachment: credential.authenticatorAttachment, // \"platform\" or \"cross-platform\"\n  autofill: true,\n});" },
    { type: "heading", text: "Gates between stages" },
    { type: "list", ordered: true, items: [
      "Prompt everyone once passkey success holds steady for two weeks. [3]",
      "Count a fallback whenever the autofill menu offered a passkey and a password was used instead. [1]",
      "Make passwords optional only when recovery stays flat after the previous stage.",
    ] },
  ],
  altLead: "Track outcomes at the sign-in page, not only enrollment. More passkeys created does not mean fewer people stuck.",
  extra: [
    { type: "heading", text: "Segment the numbers" },
    { type: "list", items: [
      "Split by platform and browser, since autofill support differs between them. [1]",
      "Compare new and long-standing accounts, which recover in different ways.",
    ] },
  ],
};

const crossDevice: AnswerScript = {
  question: "How do people sign in on a device without their passkey?",
  thought: 5,
  reasoning: "Someone on a borrowed laptop or a new work machine still needs a way in. Cross-device sign-in covers most of it, security keys cover the rest, and the password path stays as a fallback while it exists.",
  sources: [pool.apple, pool.webdev, pool.mdn, pool.wikipedia],
  blocks: [
    { type: "paragraph", text: "They can use the passkey on their phone. The browser shows a QR code, the phone scans it, and a Bluetooth proximity check confirms the two devices are near each other. [1] Nothing is installed on the borrowed device." },
    { type: "heading", text: "What to support" },
    { type: "list", ordered: true, items: [
      "**Cross-device sign-in.** Browsers offer it when you call WebAuthn normally, so there is no extra code to write. [3]",
      "**Security keys.** USB and NFC keys work on any device with a matching port or reader. [4]",
      "**Your existing fallback.** Until passwords are optional, the password and two-factor path stays available.",
    ] },
    { type: "paragraph", text: "After a cross-device sign-in on a device the person owns, offer to create a passkey there, so the next sign-in is one step. [2]" },
  ],
  altLead: "Their phone can stand in for the missing passkey. The browser shows a QR code, the phone scans it and confirms it is nearby over Bluetooth. [1]",
  extra: [
    { type: "heading", text: "Shared and public devices" },
    { type: "list", items: [
      "Do not offer to save a passkey on a device marked as shared.",
      "Keep cross-device sessions short and sign out on close.",
    ] },
  ],
};

export const answerScripts: AnswerScript[] = [rollout, recovery, metrics, crossDevice];
export const sampleQuestion = rollout.question;
