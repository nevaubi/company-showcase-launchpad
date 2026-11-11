# Waitlist emails + trial-on-acceptance

## The one step only you can do
Click "Set up email domain" and pick filedunder.ai (sender like notify.filedunder.ai). If the domain is managed by Lovable, the DNS records are added automatically; otherwise the dialog shows the records to paste at your registrar. I can't do this click for you: it confirms you own the domain.

## What I build right after (no further input needed)
1. **"We got your request" email** — sent automatically when someone signs up and lands on the waitlist. Minimal, black-and-white Filed Under style.
2. **"You're approved" email** — sent when you approve someone on the Admin page, with a button to sign in (or create an account if they haven't).
3. **Trial starts on acceptance** — approved users see a short welcome screen to accept the terms; the 14-day trial clock starts only when they click Accept (not at approval or signup).
4. Emails can be built and tested before DNS finishes; they start delivering once the domain is verified (watch More -> Emails).

## Technical details
- Scaffold app-email templates; add `waitlist-received` and `waitlist-approved` templates.
- Send receipt from the waitlist-entry path (server-side), approval from the admin approve server function; idempotency keys per waitlist row.
- Migration: `trial_accepted_at` on waitlist/subscription record; `effective_tier` trial window counts from it; acceptance screen + server fn `acceptTerms`.
- Tests: trial starts at acceptance, not before; 14-day expiry.
