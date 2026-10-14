# Admin exam exceptions: Grant Exceptional Test Access and Reset Test Attempt

Admin only. Where: **Admin > Students > (student) > Olympiad tab > "Exam access - administrator actions"**. Students never see these controls and no student API exposes them.

## The normal path is unchanged
Pay 20 rupees (2000 paise, price calculated by the backend) -> verified payment -> Start -> Submit -> teacher interview becomes available. The price, Razorpay order/verification, duplicate-payment guards and interview rules are untouched.

## Grant Exceptional Test Access
- For a student with NO verified payment. Needs: student, exam, a reason (a mandatory explanation when "Other"), explicit confirmation.
- Creates ONE `OlympiadAccessGrant` (student + exam; unique while ACTIVE). It is not a payment: no `OlympiadPayment` row, no fake Razorpay data, the price is unchanged, no other student or exam is affected.
- Optional "include teacher interview" (default on) = same package as the paid test. The interview still unlocks only after a valid submission.
- The student sees the ordinary exam card and Start; they must still start and submit (instructions, camera, proctoring, timer all apply). Nothing is auto-completed, no marks or certificate are created.
- A student who already paid is refused ("no exception needed"). A student with an active grant is not asked to pay (order creation is refused).

## Reset Test Attempt
- For a student whose attempt must be redone after a genuine technical problem. Needs: the exact exam and the exact attempt shown, a reason, confirmation.
- Allowed only when: the attempt is COMPLETED (not running), the student still has a verified payment or an active grant (a reset alone never bypasses payment), no teacher interview exists for it (cancel it first), no certificate was issued for it, and the exam window is open.
- What happens: the full attempt (answers, score, timings, submission type) is copied to `OlympiadAttemptHistory`, the attempt is removed from the active collection (the unique "one active attempt per student+exam" rule is kept), the old interview slot/reminders are cancelled, and the audit record is written. The payment/grant is never touched.
- The exam card returns to Available (Start). Starting the retake links the history row to the new attempt. The old attempt never decides the new status or the interview eligibility.
- Repeating the request, double clicks and concurrent admins create one history row and one audit record; a stale attempt id is refused.

## Audit
`ExamAdminAudit` (append-only; the model refuses update/delete): action `FREE_ACCESS_GRANTED` / `EXAM_ATTEMPT_RESET`, student, exam, standard, admin, reason, time, grant id or previous attempt + history ids. No passwords, tokens or payment secrets.

## Deploy notes
New collections only (`openaccessgrants`, `olympiadattempthistories`, `examadminaudits`); indexes are created automatically. No migration, no env var, no data change.
## Not covered
The separate AI Interview still requires a purchase. Engineering mock test access is unchanged. There is no "revoke grant" action yet.
