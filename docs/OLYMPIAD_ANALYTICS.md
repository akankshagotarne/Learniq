# Olympiad Student Analytics (admin)

Sidebar: **Olympiad → Olympiad Student Analytics** (`/admin/olympiad/analytics`, admin only).

## Definitions (from the existing models — nothing new is stored)
| Term | Rule |
|---|---|
| Registration | an `OlympiadPayment` (any visible status) or an ACTIVE `OlympiadAccessGrant` for (student, exam); an attempt with neither is shown and flagged |
| Paid | `OlympiadPayment.status = SUCCESS` (backend-verified: checkout / webhook / reconcile) |
| Eligible | Paid **or** admin access grant. Pending / failed / refunded / unconfirmed are never eligible |
| Exam status | `NOT_STARTED` (eligible, no attempt) · `IN_PROGRESS` · `SUBMITTED` (`OlympiadAttempt.status`) · `NOT_ELIGIBLE` |
| Result available | submitted + evaluated + the exam's `resultsPublishedAt` is set (admins see marks earlier; "pending" = not yet published) |
| Scope | exams with `examType != engineering` (default: all Olympiad exams, Std 1–10) |

Cards count **unique students** (a student in several exams counts once, at their furthest state: submitted > in progress > not started); table rows are registrations (student × exam). Participation rate = submitted ÷ eligible students (0 when there are none). UNCONFIRMED / archived payments are excluded and reported in the footer.

## API (all `protect + authorize('admin')`, read-only, `no-store`)
- `GET /api/olympiad/admin/analytics` — cards, tab counts, one page of rows. Params: `exam, standard, payment, participation, view, search, sort, order, page, limit, registeredFrom/To, attemptFrom/To, submittedFrom/To` (IST days, `YYYY-MM-DD`). Every value is validated / allow-listed (400 otherwise); sort ∈ name, registered, payment, examStatus, attemptDate, submissionDate, score; limit ∈ 10/25/50/100.
- `GET /api/olympiad/admin/analytics/students/:studentId[?exam=]` — profile, registrations, every payment, attempt, earlier attempts (after admin resets), certificate, verified timeline.
- `GET /api/olympiad/admin/analytics/export?format=csv` — CSV for the same filters (title, IST generation time, filters, formula-injection safe). Excel / PDF are not included.

Discrepancy flags (warnings only, nothing is repaired): `ACCOUNT_MISSING`, `ATTEMPT_WITHOUT_ENTITLEMENT`, `ATTEMPT_PAYMENT_MISMATCH`, `PAYMENT_STATUS_INCONSISTENT`, `SUBMITTED_NOT_EVALUATED`, `EXPIRED_NOT_SUBMITTED`, `DUPLICATE_SUCCESS_PAYMENTS`.

Indexes added (non-unique): `OlympiadPayment {exam, status}`, `OlympiadAttempt {exam, status}`.
Scale note: the join is done in memory per request (cap 50,000 registrations, flagged in the UI) so cards, tabs, table and export always agree.
