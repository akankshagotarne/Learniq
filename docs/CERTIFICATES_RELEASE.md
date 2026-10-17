# Certificates: universal eligibility, Participation certificate, scheduled release

## Rules
- **Eligible** = a valid, successfully submitted Olympiad attempt (`status: COMPLETED` and evaluated). Registration, payment, starting an exam and interview attendance are not eligibility.
- Every eligible student receives **two separate certificates per exam, at any score**:
  - `RESULT` - percentage + grade (`LQOLY<year>-<seq>`). Below 60% it carries no grade and the result reads "Below pass mark". Marks, percentages and grade rules are unchanged; pass/fail reporting is kept.
  - `PARTICIPATION` - Certificate of Participation (`LQPAR<year>-<seq>`), facts only: Test Status *Participated*, Interview Status *Participated / Not Participated / Pending* (from real `TeacherInterview` records), Overall Remarks *Active Participant*.
- Identity of a certificate = **student + exam + type** (unique index `one_certificate_per_student_exam_type`; also `attempt + type`). Old records are treated as `RESULT`.

## Release
- One central config: `backend/src/config/resultsRelease.js` - **18 Oct 2026, 6:00 PM IST = 2026-10-18T12:30:00Z**. Override with `RESULTS_RELEASE_AT` (an explicit offset or `Z` is required, otherwise ignored).
- State lives on the exam document (`resultsPublishAt`, `resultsPublishedAt`, `certificatesReleasedAt`), never in memory, so Render restarts and several instances are safe.
- `services/resultsRelease.isReleased(exam, now)` is the single source of truth for results AND both certificates (evaluated against the clock, so release is on time even if the server was asleep).
- `services/certificateRelease.sweep()` runs every 60 s: seeds the schedule for Olympiad exams that closed before the release, atomically records the publication (published time = the scheduled instant), then creates + generates certificates in batches of 100. One student's failure never blocks the rest; the exam is marked `certificatesReleasedAt` only when every attempt succeeded, otherwise it is retried on the next sweep.
- A certificate is `GENERATED` only after its PDF has really been rendered; `PENDING` / `FAILED` certificates are hidden from the student ("being prepared"), and `generationError` stores a code only.
- Students opening their certificates also trigger an idempotent catch-up for their own attempts (`ensureForStudent`).
- Before the release: `/certificates/mine` is empty, `generate`/download/view/verify are blocked ("not issued yet"), and the admin retry endpoint refuses.

## Endpoints
- Student: `GET /certificates/mine`, `POST /certificates/generate {examId}`, `GET /certificates/:number[/download]` (owner or admin; 404 for anyone else).
- Public: `GET /certificates/verify/:number?t=<hmac>` - both types and old certificates. The participation page shows no marks, grade or ids.
- Admin: `GET /certificates/admin/list?type=&generation=...`, `POST /certificates/admin/exams/:examId/process` (scoped, idempotent, refused before release), revoke / reinstate as before.
- `POST /olympiad/admin/exams/:id/results {publish}` still publishes early / withdraws (withdraw also clears the schedule).

## Startup migration (additive, safe)
`services/certificateMigration.js` backfills `type: 'RESULT'`, drops the two old single-certificate unique indexes and builds the new ones. No certificate is deleted or changed otherwise.

## Backfill
`node src/scripts/backfillCertificates.js` (dry run) / `--apply` - covers every submitted attempt of a **released** exam only.
