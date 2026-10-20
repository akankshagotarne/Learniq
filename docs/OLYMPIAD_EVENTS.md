# Olympiad events

An **Olympiad event** (e.g. "LearnIQ Olympiad — 24 October 2026") owns one `OlympiadExam` per standard through `OlympiadExam.event`.
Registrations, payments, attempts, results, certificates and interviews already hang off an exam, so they belong to exactly one event and are never mixed.

* **State** (stored): `draft` | `published` | `cancelled`. **Status** (derived from state + real exam schedule + registration window):
  draft, upcoming, registration_open, registration_closed, live, completed, cancelled.
* Draft events are invisible to students. Publishing needs questions in every exam. Cancelling stops registration/start, keeps every record.
  Only an unused draft can be deleted.
* Creating an event never copies student data. `copyFromEventId` copies settings; `copyQuestions` also copies the question bank.
* Admin pages (Exam Management, Analytics + CSV, Results/Certificates, Payments, Interviews, Interview Schedule) always work inside ONE selected event (`?event=`; default = live > upcoming > latest).
* API: `/api/olympiad/admin/events` (list, `/options`, `/migration-report`, create, `GET|PATCH|DELETE /:id`, `/:id/publish|unpublish|cancel`) — admin only.

## Historical data migration
On startup `migrateLegacy({apply:true})` links the original exams (`learniq-all-india-olympiad-2026-std-N`) to ONE event "LearnIQ Olympiad — 17 October 2026"
(`isLegacy`, published). It only sets `event` where empty, changes no dates/fees/questions/payments/attempts, and is idempotent.
Exams outside that slug pattern are reported (`needsReview`) and never assigned automatically.
Disable with `OLYMPIAD_EVENT_MIGRATION=off`. Report only: `node src/scripts/migrateOlympiadEvents.js`; apply: `--apply`.
Reversal: `db.olympiadexams.updateMany({}, {$unset:{event:1}})` and delete the event documents. Take an Atlas snapshot first.
