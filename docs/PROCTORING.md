# Online proctoring

Camera, face, phone, fullscreen and tab monitoring for **teacher exams** (`Exam`) and **Olympiad exams** (`OlympiadExam`).
Off by default; teachers enable it per exam in the exam builder, admins per Olympiad on the admin Olympiad page.

## How it works

| Where | What |
|---|---|
| Browser (`frontend/src/proctoring/`) | MediaPipe Tasks Vision runs **locally**: Face Landmarker (face count only, no identity) and EfficientDet-Lite0 restricted to the COCO class `cell phone`. `episodes.ts` turns frame readings into confirmed episodes (persistence + ≥2 readings, one event per episode, recovery before a new one, gaps never count as "no face"). |
| Server (`backend/src/services/proctoring/`) | Authoritative warning counters per attempt (`ProctoringSession`), event timeline (`ProctoringEvent`, TTL-deleted after `PROCTORING_RETENTION_DAYS`, default 180), dedupe (`clientEventId` + per-type cooldown), thresholds from the policy snapshot frozen at session start, automatic submission through the exam's own finalisation, teacher/admin review with an append-only audit trail. |
| Exam lifecycle | Teacher exams now have a server deadline (`ExamAttempt.deadline`), server-saved answers as the source of truth, atomic/idempotent finalisation (`services/examAttempts.js`) and a background sweeper - the same model the Olympiad already used. |

Default rules: face absence **5** warnings (5th submits) · multiple faces **3** (3rd submits) · phone **2** warnings, the next confirmed detection submits · tab switch / fullscreen exit per `switchAction` (`WARN`, `WARN_AND_REQUIRE_FULLSCREEN` default, `AUTO_SUBMIT_ON_CONFIRMED_SWITCH` = strict) · camera loss blocks the exam (`BLOCK_UNTIL_RESTORED`) or submits after a grace period.

Privacy: no frames, images, video, audio or face templates leave the device or are stored. Only structured events (type, time, confidence) are sent.

## API

Student: `GET /api/proctoring/:kind/:examId/eligibility`, `POST /api/proctoring/:kind/:examId/session`, `POST /api/proctoring/sessions/:id/events`, `POST /api/proctoring/sessions/:id/heartbeat` (kind = `exam` | `olympiad`).
Teacher (own exams) / admin: `GET|POST /api/proctoring/review/sessions/:id`. Admin: `PUT /api/olympiad/admin/exams/:id/proctoring`.
Teacher results (`GET /api/teacher/exams/:id/attempts`) and admin Olympiad results include a `proctoring` summary per attempt.

## Tests

- `cd backend && npm run test:proctoring` - rules, authorisation, idempotency, timer, concurrency (fake DB with the real unique indexes).
- `cd frontend && npm run test:unit` - episode logic.
- `cd frontend && npm run test:e2e` - UI with a fake camera and a scripted detector (e2e build only, `vite build --mode e2e`).
- Real models: `node e2e/real-model/prepare-fixtures.mjs` then `npx playwright test e2e/real-model` (scene files are generated locally and git-ignored).

## Limitations (be honest with students and staff)

- A browser cannot stop a student leaving fullscreen, switching apps, closing the tab, using a second device out of camera view, or running a modified client that never reports events. These are **detected and handled**, not prevented. High-stakes exams need a managed / lockdown environment.
- Detections can be wrong (lighting, a face on a poster or screen, a phone-shaped object). A flag means "review", not "cheated".
- On a phone or tablet the camera cannot see the device being used; use `desktopRequired` for high-stakes exams. iPhone Safari has no fullscreen API, so fullscreen-required exams cannot start there.
- First load downloads about 10-20 MB (WebAssembly + models), cached afterwards. Inference measured in this project's tests: 51-76 ms per face check, 157-207 ms with the phone model, on a CPU-only container. Slow devices are not yet measured.
- The committed model files came from an npm mirror (see `frontend/public/proctoring/models/README.md`); replace them with Google's official downloads and compare hashes before relying on them.
- Students under 18: obtain the consent and disclosures your organisation and local law require; this feature does not establish legal compliance.
