# Clear a student's Olympiad records (admin)

**Where:** Admin → Olympiad → Olympiad Student Analytics → *View Profile* → **Olympiad Records / Exam History**
(`🗑️ Clear Olympiad Records` for all exams, `Clear this exam` per row). Both open a confirmation dialog first.

## API (admin only, `protect` + `authorize('admin')`)
| Method | Route | Effect |
|---|---|---|
| DELETE | `/api/olympiad/admin/analytics/students/:studentId/exams/:examId/records` | clear one exam |
| DELETE | `/api/olympiad/admin/analytics/students/:studentId/records` | clear every Std 1-10 exam of that student |

404 `NOTHING_TO_CLEAR` when there is nothing (already cleared / wrong student+exam), 409 when protected, 400 for bad ids / non-student
accounts, 401/403 for anonymous / non-admin. The success message is only sent after the deletes succeeded.

## How a "registration" works here
There is no registration collection. A student is registered when a payment was verified (`OlympiadPayment` SUCCESS) or an admin
granted access (`OlympiadAccessGrant`). Payments must be kept, so clearing writes an **`OlympiadClearance`** marker
(student, exam, clearedAt, admin, scope, counts). `services/olympiadAnalytics.js` drops a cleared registration inside
`loadRegistrations` (the query layer) so cards, tabs, search, filters, paging and CSV all agree. A cleared registration comes back
only if something **new** happens after the clearing (new attempt, new verified payment, new access grant).

## Deleted (always scoped by student + exam)
`OlympiadAttempt` (answers, submission, score) · `OlympiadAttemptHistory` · `ProctoringSession`/`ProctoringEvent` of those attempts ·
`TeacherInterview` + `InterviewEvaluation` of that exam (they depend on the attempt).

## Never touched
Users, `OlympiadPayment` / Razorpay data (all statuses), `Payment`, `Certificate`, `OlympiadAccessGrant`, exams, questions, interview
slots/reminders, AI interviews, engineering exams, other students, other exams.

## Refused (nothing deleted for that exam, 409)
* `CERTIFICATE_ISSUED` – the certificate PDF/QR reads the attempt's score; deleting it would silently break verification.
* `ACTIVE_INTERVIEW` – a teacher interview for the exam is still open.
* `EXAM_IN_PROGRESS` – the student is taking the exam right now.
"Clear all" skips such exams, clears the rest and reports the skipped ones.

## Atomicity
On a replica set (Atlas) the deletes + marker run in one transaction; on a standalone server they run in a fixed, re-runnable order
(children first, marker last) – a failure leaves the registration visible and a retry completes it. The service does not claim atomicity there.

## Audit
One `ExamAdminAudit` row per cleared exam: `action: OLYMPIAD_RECORDS_CLEARED`, admin, student, exam, scope, per-collection counts, time.
No credentials or payment details.

## Known limitation
The student's payment entitlement is preserved, so a student who paid can open the exam again and create a new attempt (it then
reappears in analytics as new participation). Revoking that is a payment decision and was deliberately not done.

## Tests
`npm run test:clearance` (backend), `e2e/olympiadAnalytics.spec.ts` (UI).
