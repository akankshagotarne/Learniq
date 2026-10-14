# Teacher–Student Interview (Olympiad)

A live, two-way video interview between an approved teacher and a student. **It is separate from the AI Interview / LiveAvatar** (different routes, models, screens).

## Rules (all enforced by the backend)
- The ₹20 Olympiad purchase includes the exam **and** this interview - there is no separate fee.
- A student is eligible only after a **submitted** exam attempt (`OlympiadAttempt.status === 'COMPLETED'`) on a **successful** payment. Any marks qualify. Opening or starting the exam does not.
- Student card: *Start Exam*, and directly under it *Start Interview — Locked* ("Submit your Olympiad exam to unlock the interview.") which becomes *Start Interview* once the backend says so.
- Flow (student-initiated, like Live Classes): `REQUESTED` ("Waiting for Teacher Approval") → any authorised teacher clicks **Accept Request** (one atomic update = claim + approve) → `APPROVED/CONNECTING` (the waiting student enters by itself) → `IN_PROGRESS` → teacher **End Interview & Evaluate** → `EVALUATION_PENDING` → teacher submits the evaluation → `COMPLETED` (or `CANCELLED` / `FAILED`).
- Teacher-initiated path still exists: teacher **Start Interview** → `ASSIGNED` → student **Join** → `WAITING_FOR_APPROVAL` → teacher **Approve**.
- **The interview is COMPLETED only when the evaluation is submitted.** Ending the call or leaving the room never completes it; `EVALUATION_PENDING` keeps the teacher slot and is never swept as stale.
- Exams tab (student): a submitted exam whose interview is not `COMPLETED` stays under **Available** with its score and the interview action/status; only a completed interview moves it to **Completed**. Cancelled/failed = not completed (retry allowed). Exams without an interview keep the old rule. Logic: `frontend/src/utils/examTabs.ts`; the stage comes from the backend (`workflowOf`).
- The student can enter the room **only after explicit teacher approval**.
- One open interview per student+exam (partial unique index), one live interview per teacher (partial unique index), claims are status-conditioned atomic updates - two teachers can never take the same student.
- Different teachers can interview different students at the same time; each interview has its own private room (`interview:<id>`), authorised by the backend on every join. A room holds two people at most.
- Admin can enable/disable *new* requests; interviews already running are not touched.

## Where things are
| Area | Files |
|---|---|
| Models | `backend/src/models/TeacherInterview.js` (`TeacherInterview`, `InterviewEvaluation`, `InterviewSetting`) |
| Criteria | `backend/src/config/interviewCriteria.js` (5 criteria x 10 = 50; fixed in code) |
| Rules | `backend/src/services/interviews.js` |
| API | `backend/src/routes/interviews.js` → `/api/interviews/*` |
| Signalling | `backend/src/services/interviewSocket.js` (socket.io; offer/answer/ICE relay only) |
| Student UI | `OlympiadExamCard.tsx`, `StudentInterviewPage.tsx`, `StudentInterviewResultsPage.tsx` (`/student/interview-results`) |
| Teacher UI | sidebar **Interview**, `pages/teacher/TeacherInterviewPage.tsx`, `TeacherInterviewRoomPage.tsx`, `components/interview/InterviewEvaluationForm.tsx` |
| Admin UI | sidebar **Interviews**, `pages/admin/AdminInterviews.tsx` |
| WebRTC | `hooks/useInterviewRoom.ts`, `components/interview/InterviewRoomView.tsx` |

## Evaluation & marks
- Criteria (whole numbers 0-10): Communication Skills, Confidence and Self-Presentation, Subject Knowledge and Understanding, Listening Skills and Comprehension, Logical Thinking and Problem-Solving. Total 50.
- The **server** validates every score (integers 0-10 only) and computes total/percentage; totals sent by a client are ignored. Remarks/strengths/improvements max 1500 chars.
- Teacher: *Save Draft*, *Preview Evaluation*, *Submit Evaluation* -> confirmation dialog -> submit. A failed submit keeps what was typed. Submitting twice is idempotent (one evaluation per interview, unique index).
- A submitted evaluation is **locked**. Only an admin can correct it (`PUT /api/interviews/admin/:id/evaluation`, reason required); the previous version is kept in `revisions` and the action is audited.
- Student sees only their own **final** marks and feedback (never drafts) on *Interview Results*; before submission: "Your interview evaluation has not been submitted yet."
- Admin: *Interviews* page (tabs, filters, search, evaluation detail with history). CSV export has score columns, never feedback text or secrets. Admin never gets live audio/video.

### Endpoints added
`GET /results` (student) - `POST /:id/accept`, `POST /:id/end`, `GET|PUT /:id/evaluation`, `POST /:id/evaluation/submit` (teacher) - `PUT /admin/:id/evaluation` (admin). The old `/complete` endpoint was removed (completion now requires the evaluation).

## Media
Browser WebRTC, peer to peer. The server only relays signalling inside one interview room. **Nothing is recorded or stored.** Presence (who is in the room) and timestamps are stored for the admin view; no media metadata beyond that.

## Configuration (no secrets in the repo)
Optional, all in `backend/.env.example`:
- `INTERVIEW_STUN_URLS` - comma-separated STUN servers (default: Google public STUN).
- `INTERVIEW_TURN_URLS`, `INTERVIEW_TURN_USERNAME`, `INTERVIEW_TURN_CREDENTIAL` - a TURN relay. **Without TURN, a few strict networks (symmetric NAT / some corporate or mobile carriers) cannot connect.** Add TURN in Render env if users report "Connecting…" that never finishes.
- `INTERVIEW_STALE_MINUTES` - how long a live interview may be silent before the sweeper closes it (default in `.env.example`).
No database migration is required; indexes are created by Mongoose on first start.

## Tests
- Backend: `cd backend && npm run test:interviews` (34 tests: eligibility, atomic accept/concurrency, approval gate, authorisation, simultaneous interviews, evaluation scoring/validation/locking/admin correction, student results, stale recovery, admin stats/CSV, real socket.io rooms).
- Exam-tab rules: `cd frontend && npm run test:unit`.
- Frontend UI against a mocked API (incl. 360px phone layouts): `cd frontend && npx playwright test e2e/interview.spec.ts`.
- **Real browsers, real WebRTC** (Chromium fake camera/microphone, real signalling server on an in-memory DB): `cd frontend && npm run test:e2e:media`.

### What is NOT covered by automated tests
Physical webcams/microphones, Safari/Firefox/mobile browsers, real-network quality (packet loss, TURN relay), and the live production site. Do a manual two-device check after each deployment: teacher + student on different networks.
