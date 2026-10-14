# Teacher–Student Interview (Olympiad)

A live, two-way video interview between an approved teacher and a student. **It is separate from the AI Interview / LiveAvatar** (different routes, models, screens).

## Rules (all enforced by the backend)
- The ₹20 Olympiad purchase includes the exam **and** this interview - there is no separate fee.
- A student is eligible only after a **submitted** exam attempt (`OlympiadAttempt.status === 'COMPLETED'`) on a **successful** payment. Any marks qualify. Opening or starting the exam does not.
- Student card: *Start Exam*, and directly under it *Start Interview — Locked* ("Submit your Olympiad exam to unlock the interview.") which becomes *Start Interview* once the backend says so.
- Flow: `REQUESTED` → teacher **Start Interview** (atomic claim) → `ASSIGNED` → student **Join Interview** → `WAITING_FOR_APPROVAL` → teacher **Approve** → `APPROVED/CONNECTING` → `IN_PROGRESS` → `COMPLETED` (or `CANCELLED` / `FAILED`).
- The student can enter the room **only after explicit teacher approval**.
- One open interview per student+exam (partial unique index), one live interview per teacher (partial unique index), claims are status-conditioned atomic updates - two teachers can never take the same student.
- Different teachers can interview different students at the same time; each interview has its own private room (`interview:<id>`), authorised by the backend on every join. A room holds two people at most.
- Admin can enable/disable *new* requests; interviews already running are not touched.

## Where things are
| Area | Files |
|---|---|
| Models | `backend/src/models/TeacherInterview.js` (`TeacherInterview`, `InterviewSetting`) |
| Rules | `backend/src/services/interviews.js` |
| API | `backend/src/routes/interviews.js` → `/api/interviews/*` |
| Signalling | `backend/src/services/interviewSocket.js` (socket.io; offer/answer/ICE relay only) |
| Student UI | `OlympiadExamCard.tsx`, `pages/student/StudentInterviewPage.tsx` |
| Teacher UI | sidebar **Interview**, `pages/teacher/TeacherInterviewPage.tsx`, `TeacherInterviewRoomPage.tsx` |
| Admin UI | sidebar **Interviews**, `pages/admin/AdminInterviews.tsx` |
| WebRTC | `hooks/useInterviewRoom.ts`, `components/interview/InterviewRoomView.tsx` |

## Media
Browser WebRTC, peer to peer. The server only relays signalling inside one interview room. **Nothing is recorded or stored.** Presence (who is in the room) and timestamps are stored for the admin view; no media metadata beyond that.

## Configuration (no secrets in the repo)
Optional, all in `backend/.env.example`:
- `INTERVIEW_STUN_URLS` - comma-separated STUN servers (default: Google public STUN).
- `INTERVIEW_TURN_URLS`, `INTERVIEW_TURN_USERNAME`, `INTERVIEW_TURN_CREDENTIAL` - a TURN relay. **Without TURN, a few strict networks (symmetric NAT / some corporate or mobile carriers) cannot connect.** Add TURN in Render env if users report "Connecting…" that never finishes.
- `INTERVIEW_STALE_MINUTES` - how long a live interview may be silent before the sweeper closes it (default in `.env.example`).
No database migration is required; indexes are created by Mongoose on first start.

## Tests
- Backend: `cd backend && npm run test:interviews` (26 tests: eligibility, atomic claim/concurrency, approval gate, authorisation, simultaneous interviews, stale recovery, admin stats/CSV, real socket.io rooms).
- Frontend UI against a mocked API: `cd frontend && npx playwright test e2e/interview.spec.ts`.
- **Real browsers, real WebRTC** (Chromium fake camera/microphone, real signalling server on an in-memory DB): `cd frontend && npm run test:e2e:media`.

### What is NOT covered by automated tests
Physical webcams/microphones, Safari/Firefox/mobile browsers, real-network quality (packet loss, TURN relay), and the live production site. Do a manual two-device check after each deployment: teacher + student on different networks.
