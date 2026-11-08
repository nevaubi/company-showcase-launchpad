# Pricing and access tiers (US, Stripe)

## Suggested tiers

Your costs mostly come from AI use: the research agent, report writing, transcripts and web research. Reading data costs very little. Each tier should match what it costs you to serve.

| | Trial | Research | Pro (AI) |
|---|---|---|---|
| Price | Free, 14 days | $39/mo or $390/yr | $129/mo or $1,290/yr |
| Who it's for | Evaluating | Investors who read and verify | Analysts who want the work done for them |
| Financials, click-to-source, filings, IR data, valuation, insiders, supply map | Yes | Yes | Yes |
| Report library (pre-built standard reports) | 3 reports | Unlimited | Unlimited |
| Excel / Word exports | No | Yes | Yes |
| Research agent (assistant) | 10 questions/day | 15/day | 150/day + deep mode |
| Custom AI reports, briefs, redline summaries | 2 total | 5/mo | 60/mo |
| Automations (alerts, scheduled briefs, watchlist digests) | No | Basic alerts | Scheduled AI briefs + digests |
| Cloud browser runs, web research | No | No | Yes |

Reasoning:
- $39 puts Research in line with similar data tools (Koyfin, Fiscal.ai are roughly $25–$80). Click-to-source is the difference that justifies this price.
- $129 for Pro stays far below enterprise tools (AlphaSense, Tegus cost thousands a year). It still covers heavy AI use at about a 70% margin, with the limits above.
- Yearly plans get two months free.
- Later: a Team/firm plan at about $99 per seat (min. 3) using the existing firm workspaces. Not in this phase.

## After the trial

Your account becomes read-only. You keep your saved work and can still browse company pages. AI tools, exports and automations lock until you subscribe.

## Payments

You're in the US, so you can use Stripe's built-in payments. Stripe handles sales tax, fraud and disputes for about 3.5% per transaction on top of its normal fees. A test mode comes first. Taking real money requires claiming the Stripe account.

## Build steps

1. Add plans to accounts: trial start/end, tier, status. The waitlist approval starts the trial.
2. Gate features by tier, both in the database and in server actions (not just by hiding buttons).
3. Enforce daily and monthly AI limits with a usage counter, and show usage on the Billing page.
4. Turn on Stripe and create 4 prices (Research and Pro, monthly and yearly). Add checkout, a billing portal, and a webhook that updates the tier.
5. Add a pricing page, upgrade prompts at locked features, and a trial countdown banner.
6. Tests for each rule: trial length, read-only after trial, the limit for each tier, and what each tier can open.

## Technical notes
- New `subscriptions` and `usage_counters` tables with service-role writes; RLS reads own row only.
- `requireAppAccess` gains a `requireTier('pro')` helper; limits checked atomically in an RPC.
- Stripe webhook under `/api/public/stripe/webhook`, signature-verified.
- Tax: `managed_payments` on checkout sessions; SaaS tax code on each product.

## Decisions for you
- Are these prices and limits OK, or should we go cheaper/higher?
- Two paid tiers (Research + Pro) or only Pro as before?
