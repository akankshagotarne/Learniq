# Refer & Earn and Exam Credits

A student shares a personal code. When a **genuinely new student** registers with it, the referrer earns **1 exam credit**
(configurable by an admin; default 1). **1 credit = permission to open one eligible paid Olympiad exam without paying.**
Credits are not money: they cannot be sold, transferred or withdrawn, and they do not expire.

## Data (backend/src/models/Referral.js)

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `ReferralProfile` | one stable code per student (`LQ` + 6 unambiguous characters) | unique `user`, unique `code` |
| `Referral` | one record per referred student (status, reward status, review timeline) | **unique `referred`** (a student has only one referrer) |
| `CreditAccount` | cached integer balance, never below 0 | unique `student` |
| `CreditTransaction` | immutable ledger (update/delete are refused) | **unique `idempotencyKey`** |
| `CreditGrantBatch` | one admin grant (single or bulk) with per-student outcomes | unique `batchId`, unique `admin + requestId` |
| `ReferralSettings` | programme switches and limits | unique `key` |

Codes and balances are created on first use; there is **no migration or back-fill**.

## Consistency without multi-document transactions (services/credits.js)

* Credit (+): insert the ledger row first (unique key) → only the request that inserted it increments the balance.
* Debit (−): conditional atomic decrement (`balance >= n`) → then the ledger row; a loser of a key race puts its own decrement back.
* A crash between the two writes leaves `balance != ledger total`; `reconcile()` (admin "Check balances", API `POST /referrals/admin/reconcile`)
  reports it and can repair accounts that have been quiet for 2 minutes. It never guesses while an operation may be in flight.
* Idempotency keys: `referral:<id>`, `grant:<batch>:<student>`, `adjust:<admin>:<requestId>`, `reverse:<tx>`, `redeem:<student>:<exam>`.

## Redemption

`POST /api/olympiad/exams/:id/credit/redeem` checks the same rules as paying (eligible standard, registration window, no attempt,
no existing entitlement, paid exam), charges one credit and creates an `OlympiadAccessGrant` with `source: 'CREDIT'`.
**No `OlympiadPayment` and no Razorpay order is ever created**, so payment and revenue reports stay true. If the entitlement cannot be
created, the credit is returned by a linked ledger entry.

## Abuse prevention

Unique referred student, self-referral checks (same account, e-mail or phone), a code cannot be attached after registration, a velocity
signal (more than N referrals/hour → `UNDER_REVIEW`, reward withheld until an admin approves), validation endpoint rate-limited per IP and
answering only valid / not valid, admin reject needs a reason and an explicit decision about an already-paid reward.

## Admin

`/admin/refer-earn`: Overview, All referrals (server-side filters, detail, review), Credit transactions, Send exam credits (single + bulk
with confirmation, batch ID, per-student results, safe retry with the same request id), Settings. CSV exports neutralise formula injection.

## Tests

`cd backend && node --test src/tests/referAndEarn.test.js` and `cd frontend && npx playwright test e2e/referAndEarn.spec.ts`.
The backend tests use in-memory collections with the real unique indexes; they do not prove behaviour on a real MongoDB under load.
