# Cleanup of old Olympiad exam + interview records (before 17 Oct 2026, 00:00 IST)

Script: `backend/src/scripts/cleanupOldOlympiadRecords.js` (logic in `src/services/oldRecordCleanup.js`). **Nothing runs automatically.**
Cutoff: `2026-10-16T18:30:00.000Z` = 17 Oct 2026 00:00:00 IST. A record is old only if its timestamp is **strictly earlier**.

## What the code inspection found
- No cascade hooks exist; `OlympiadAttempt` holds answers + score + result in one document. Payments never reference attempts (attempt → payment only), so deleting attempts cannot cascade into payments.
- `Certificate.attempt` is required and unique, and the certificate PDF / QR verification read the attempt's score. **An old attempt with a certificate is therefore kept** (reported as protected).
- `ExamAdminAudit` is append-only and is never touched. `OlympiadExam`, `OlympiadQuestion`, `InterviewSchedule`, `InterviewSetting`, users, payments, certificates are never touched.
- `db.js` falls back to a local database; the cleanup script deliberately does **not** use it.

## Dated by
| Records | Deleted when |
|---|---|
| OlympiadAttempt | submitted: `submittedAt` < cutoff; not submitted: `startedAt` < cutoff. Missing time → review. Certificate exists → kept. Interview activity on/after cutoff → kept, review |
| OlympiadAttemptHistory | its attempt time < cutoff and the reset itself was also before the cutoff (else review) |
| ProctoringSession / Event | belongs to a deleted attempt (sessions with no attempt anywhere → review) |
| TeacherInterview + InterviewEvaluation | its attempt is deleted; with no attempt record left: its own timestamps all < cutoff |
| InterviewSlot | the whole appointment ends before the cutoff (spanning → review) |
| InterviewReminder | its slot is deleted (a SENT reminder of a kept slot stays: its dedupe key prevents a second message) |
| AIInterview | latest of started / completed / first question / consumed (else created) < cutoff |

`--exclude-engineering` keeps the free BE mock-test attempts (same exam engine) out of the cleanup; by default they are included, and the dry run lists attempts per exam so you can see them.

## Runbook
1. **Dry run** (read-only):  `MONGODB_URI='<production uri>' node src/scripts/cleanupOldOlympiadRecords.js`
   Shows the database name + host (no credentials), per-collection counts (examined / to delete / preserved / protected / review), reasons, attempts per exam, protected counts and a **plan hash**. Needs a machine that can reach the database (Atlas IP access list) or the Render shell.
2. **Backup**: Atlas → Backup → *Take snapshot now* (or `mongodump`). Wait until it is complete.
3. **Execute**:
```
MONGODB_URI='<production uri>' node src/scripts/cleanupOldOlympiadRecords.js --execute \
  --expect-db=<database name from the dry run> --plan-hash=<hash from the dry run> \
  --atlas-backup-confirmed --archive-dir=<private folder> --confirm=DELETE-OLD-OLYMPIAD-RECORDS
```
It re-plans (the hash must match), writes and verifies a recovery archive (NDJSON, mode 0600, contains student data: never commit it), deletes by exact `_id` children-first (a document modified after planning is skipped), then verifies: per-collection counts, users / payments / certificates / exams / questions unchanged, no certificate pointing at a missing attempt. The audit report (ids only, no personal data) is written to `./cleanup-output/`.
4. Re-running finds nothing more to delete (idempotent). Restore = re-insert the NDJSON lines (or restore the snapshot).

Tests: `npm run test:cleanup` (9 tests, in-memory database).
