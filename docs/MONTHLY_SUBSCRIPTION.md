# Monthly Subscription — behaviour, dates and Razorpay setup

## Product rules
- Plan: ₹99 (MRP ₹120, 17% off), 30 days, **one standard** (Std 1–10). Unlimited exams and interviews of that standard, no credits deducted.
- Other standards follow the normal rules. A plan never moves when the student changes standard.
- Prices come from `backend/src/config/subscriptionPlan.js` (paise). The browser never sends an amount.

## Three different dates (they are not the same thing)
| Name | Meaning | Where it comes from |
|---|---|---|
| **Entitlement end** (`endsAt`) | Exclusive end of the paid access. Purchase day = day 1; `endsAt` = 00:00 IST of the purchase day + 30 days (stored in UTC). | `subscriptionDates.nextPeriod` |
| **Valid till** | The last paid *day*, `endsAt − 1 ms`, shown in IST. Bought 05 Nov → valid till 04 Dec. | `subscriptionDates.validTill` |
| **Next payment** (`nextChargeAt`) | When Razorpay will charge the next cycle. Only ever the `charge_at` Razorpay reports. | Razorpay subscription entity |

Razorpay's plan is `daily × 30`, so it charges exactly 30 × 24 h after the previous charge, at the time of day of the first
payment. The entitlement ends at an IST midnight, so the charge normally lands **up to ~24 h after `endsAt`**
(example: bought 05 Nov 15:00 IST → valid till 04 Dec, `endsAt` 05 Dec 00:00 IST, next payment 05 Dec 15:00 IST).

**No gap rule.** While auto-renew is genuinely on (`authenticated` / `active` / `pending`) access continues for up to
`RENEWAL_GRACE_MS` (30 h) after `endsAt`, so a student is never locked out while the renewal is being collected. It is
never granted for a manual (one-time) plan, after `halted` / `cancelled` / `completed`, or after the window. The charge
then adds exactly +30 days **from `endsAt`** (not from the payment time), so the 30-day alignment never drifts.

## Auto-renew states (only from verified data)
- Turned **on** only when Razorpay confirms the mandate (`authenticated`/`active`, our plan, this student, this standard) —
  by `/verify` (fetches the subscription from Razorpay) or by the `subscription.authenticated|activated` webhook.
  The checkbox alone never turns it on.
- `pending` = a renewal charge failed and Razorpay is retrying (we do not run our own retries). Access follows the paid period.
- `halted` = Razorpay gave up. Auto-renew is off; access ends at `endsAt`; the student renews manually.
- Turning auto-renew **off** cancels at the end of the cycle on Razorpay and never shortens access.
- A delayed or old Razorpay event cannot undo a newer state: events older than the last applied event are ignored, events of an
  older gateway subscription cannot switch off a newer one, and `halted`/`cancelled`/`completed` cannot be revived by a late event.
- A charge is always recorded exactly once per Razorpay payment id (`razorpayPaymentId` is unique); a failed renewal is
  recorded once per event (`eventKey`) and never adds access.

## Razorpay setup (TEST first)
1. Enable **Subscriptions** in the Razorpay Dashboard (test mode, then live).
2. `node backend/src/scripts/createSubscriptionPlan.js` — reuses an existing matching plan, otherwise creates one; prints the plan id and the key mode.
3. Set on Render: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_MONTHLY_PLAN_ID` (all TEST **or** all LIVE — never mixed; a TEST plan id does not exist in LIVE).
4. Webhook URL: `https://<render-backend>/api/payments/razorpay/webhook`. Events: `payment.captured`, `order.paid`, `payment.failed`,
   `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`,
   `subscription.cancelled`, `subscription.completed`.
5. Frontend (Vercel): `VITE_RAZORPAY_KEY_ID` = the same mode's key id (public).

## Admin reporting
Subscription payments are a third source in `services/paymentStats.js` (paise → rupees). Revenue = `paid` charges only.
`failed`, `created` (abandoned checkouts) and `AUTOPAY_SETUP` (mandate bookkeeping) rows are never revenue. The stats include a
one-time vs recurring breakdown and failed-renewal count; the admin export supports `type`, `standard`, `from`, `to` filters.
Refunds are not modelled for subscriptions yet (no refund flow exists).
