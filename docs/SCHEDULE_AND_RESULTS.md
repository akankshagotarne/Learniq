# Olympiad schedule, completion screens and result publication

All instants are explicit Asia/Kolkata (IST, UTC+05:30) moments evaluated on the **server clock** (`backend/src/config/schedule.js`). A browser clock is never consulted. Opening is inclusive, closing is exclusive.

| Activity | Opens | Closes |
|---|---|---|
| Olympiad test (Std 1-10) | 17 Oct 2026 09:00 IST | 17 Oct 2026 21:00 IST |
| Teacher interview | 18 Oct 2026 09:00 IST | 18 Oct 2026 19:00 IST |
| Interview results announcement | 18 Oct 2026 18:00 IST | - |

Staging overrides (full ISO with offset): `OLYMPIAD_EXAM_OPENS_AT`, `OLYMPIAD_EXAM_CLOSES_AT`, `OLYMPIAD_INTERVIEW_OPENS_AT`, `OLYMPIAD_INTERVIEW_CLOSES_AT`, `OLYMPIAD_INTERVIEW_RESULTS_AT`.

## Where the test window lives
Every Olympiad exam record stores `startDate` / `endDate` (read by `windowState()`). They are kept equal to the config by the seeder, by `services/olympiadSchedule.js` at server start (writes only those two fields, only where they differ; `OLYMPIAD_WINDOW_SYNC=off` disables it) and by `scripts/setOlympiadEndDate.js`.

## Payment
One payment of ₹20 (test ₹10 + interview ₹10) via the existing Razorpay flow. Paying early is allowed; payment never unlocks the test or the interview before its opening time. Admin exceptions follow the same windows.

## Test (17 Oct)
* Before 09:00: card shows Upcoming + "This examination opens on 17 October 2026 at 9:00 AM IST."; start is refused with `NOT_STARTED`.
* 09:00:00.000 - 20:59:59.999: eligible students (paid or admin-authorised) can start.
* From 21:00:00.000: new starts and new registrations are refused with `CLOSED`.
* **An attempt started before 21:00 keeps its own timer** (`deadline = startedAt + duration`, `hardClose` is off): a student who starts at 20:59 may submit until 21:59 + the 10 s network grace. History, submissions and payments are untouched.

## Result hiding
After a valid submission the backend scores the attempt with the existing logic and stores everything (admins see it). Students receive only `{ released: false, status: 'SUBMITTED' }` plus `completion` (`interviewSelected`, `interviewDate`). `GET result`, `GET review`, `GET completed`, `GET exams`, the submit response, certificates (`/api/certificates/*`) all withhold marks, answers, explanations and pass/fail until an administrator publishes the exam's results (`POST /api/olympiad/admin/exams/:id/results {publish}`, audited in `resultsAudit`; Admin > Olympiad Exams). `getReview` answers 403 `RESULT_NOT_PUBLISHED`.

**Selection rule:** every student with a valid submitted attempt (and a paid / authorised entitlement) is eligible for the interview, so the completion screen shows "You are selected for tomorrow's interview!" for every Olympiad submission. If eligibility were ever false, the screen shows "Please wait for confirmation of your interview eligibility." No score-based threshold exists or was invented.

## Interview (18 Oct)
* Before 09:00: no request, accept, join or room entry (`INTERVIEW_NOT_OPEN`).
* 09:00 - 18:59:59.999: the student requests; the teacher must accept/approve; teachers cannot start anything.
* From 19:00:00.000: new requests, accepts, join-requests and approvals are rejected (`INTERVIEW_CLOSED`). **An interview already approved/in progress at 19:00 may finish** (room access stays valid, the teacher can end it and submit the evaluation). Requests still unaccepted at 19:00 stay `REQUESTED` (they can be cancelled by the student or admin / recovered by "Recover stale").
* Completed = the teacher's evaluation is submitted. Ending the call without evaluating leaves `EVALUATION_PENDING`.

## Interview results
Visible to the student only when the evaluation is final **and** released: `resultsMode` = `schedule` (default: from 18:00 IST), `published` (admin released now) or `held` (admin withholds even after 18:00); changes are audited (`resultsAudit`; Admin > Interview Management > Results). Before release the student sees the completion screen only (no marks, remarks, strengths or selection). After 18:00 without release the screen says the results are being finalised. Unfinished evaluations never produce a result.

### Known schedule conflict (needs an administrator decision)
Interviews may run until 19:00 but results are announced at 18:00. Interviews finishing after 18:00 get their result only when their evaluation is final and results are released (use Published/Held to coordinate). Neither time was changed silently; to give everyone their result at the same moment, move the announcement time to after 19:00 (`OLYMPIAD_INTERVIEW_RESULTS_AT`) or close the interview window earlier.
