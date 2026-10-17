# Olympiad Student Analytics — registration & submission tracking (admin)

Admin page `/admin/olympiad/analytics` (sidebar: Olympiad → Olympiad Student Analytics). **Read-only.** It answers one question:
*who registered, and have they submitted their exam?* Payment management stays in the separate Payments section.

## Definitions (taken from the existing models, not assumed)
| Term | Meaning |
|---|---|
| Registered / eligible | a verified payment (`OlympiadPayment.status = SUCCESS`) **or** an ACTIVE admin access grant for (student, exam). Same rule that already decides exam access. Payment data is used only to decide this — it is never returned by this report. |
| Submitted | the student's `OlympiadAttempt` has `status = COMPLETED` (set only by a successful submission). |
| Not Submitted | registered, but no COMPLETED attempt — never opened **or** started and not submitted. |
| Submission date | the server-recorded `submittedAt`; `—` when not submitted. The attempt start time is never shown or used. |
| Registration date | when the registration became valid: verified-payment time or admin-grant time (earliest). |
| Scope | Std 1–10 Olympiad exams; the free engineering mock test is excluded. |

Pending / failed / unconfirmed payments with no attempt are **not registrations** and are not listed. An attempt without a valid registration is shown and marked "Needs review"; it is not counted in the cards.

## Cards (unique students, one consistent scope = exam + standard + registration date)
Total Registered Students · Submitted · Not Submitted (= registered − submitted) · Submission Rate (= submitted ÷ registered, 0% when nobody is registered). A student in several exams counts once; they are "Submitted" if they submitted any registered exam in scope. Table rows and tab counts are registrations (student × exam), so they differ from the cards only when several exams are in scope (stated on the page).

## Page
Filters: Olympiad exam · Standard · Exam participation (All / Submitted / Not Submitted) · optional Registration date range · Reset filters. Tabs: All Students · Registered · Submitted · Not Submitted (server counts). Debounced search (name, email, mobile, student ID, exam), sort by student, standard, registration date, submission date, server-side paging (10/25/50/100). Table columns: Student · Standard · Exam · Registration date · Exam status · Submission date · Action (View Profile). Phones get a stacked card per record. Clicking a name opens a read-only profile (drawer on desktop, full screen on phones): student details, per-exam registration, status, submission time, marks, result, certificate, earlier attempts kept after an admin reset.

## API (all `protect` + `authorize('admin')`, read-only, `Cache-Control: no-store`)
- `GET /api/olympiad/admin/analytics` — cards, tab counts, one page of rows. Params: `exam, standard, participation, view, search, sort, order, page, limit, registeredFrom, registeredTo` (IST days `YYYY-MM-DD`). Every value is validated / allow-listed (400 otherwise); `view` ∈ all, registered, submitted, not_submitted; `sort` ∈ name, standard, registered, submissionDate; `limit` ∈ 10/25/50/100.
- `GET /api/olympiad/admin/analytics/students/:studentId[?exam=]` — profile and registrations (no payment data).
- `GET /api/olympiad/admin/analytics/export?format=csv&...same filters` — only the filtered records; columns Student, Student ID, Email, Mobile, Standard, Exam, Registered (IST), Exam status, Submitted (IST); formula-injection safe.

## Limits
The join is in memory per request (capped at 50,000 registrations, flagged in the UI). The account schema has no school/college field, so the profile shows "Not recorded". Marks are visible to admins before results are published.

Tests: `npm run test:analytics` (backend), `e2e/olympiadAnalytics.spec.ts` (UI).
