# Finish payments, trial and access, test, publish

## What gets finished
1. **Cancellations**: cancel or switch plans in Manage billing. A cancelled plan keeps working until the paid period ends, then falls back to the expired state. Billing shows "Ends on {date}" and a past-due warning when a payment fails.
2. **Free trial**: 14 days from waitlist approval. A countdown banner shows in the app during the last 5 days and after the trial ends, with a Subscribe link.
3. **Features locked by plan**, checked on the server, not just by hiding buttons:
   - Exports (Excel/Word/IR workbook): Research and Pro
   - Assistant deep mode, web research, cloud browsers: Pro
   - Expired trial: read-only (company pages and saved work stay; AI tools, exports and automations are locked)
   - Locked buttons show an upgrade prompt that opens Billing.
4. **Pricing page** (`/pricing`): show the real three plans with live prices and Start trial / Subscribe buttons.
5. **After checkout**: Billing confirms the payment and refreshes the plan.

## Testing (done by me)
- Rule tests: trial length, cancellation end-of-period access, limits, and what each plan can open.
- In the preview as your account and as a test trial account: run a full test card payment, confirm the plan switches to Research, cancel in the billing portal, confirm access holds to period end, and confirm locked features refuse on an expired trial.

## Publish
Publish once tests pass. Real charges still need you to claim the payment account in the Payments tab. Until then the live site shows checkout as not yet available.

## Technical notes
- Add `cancel_at_period_end` to `subscriptions`; `effective_tier` counts `canceled` with a future `current_period_end`; webhook stores both.
- Add a `require_feature` SQL function plus `requireFeature(feature)` server middleware on export, browser, web research and deep-mode server functions; the client `usePlan()` hook drives prompts and the banner.
- Test account: create a confirmed auth user with an approved waitlist row backdated 15 days, for the expired-trial check.
