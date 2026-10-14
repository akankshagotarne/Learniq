# Teacher/student interview room - stability notes

Video stack: **plain browser WebRTC** (peer to peer) + the existing socket.io signalling (`backend/src/services/interviewSocket.js`). There is no LiveKit/third-party video provider in this flow; media never goes through the server.

## What was wrong (verified)
| # | Defect | Evidence |
|---|---|---|
| 1 | `getUserMedia()` and the room-access request had **no timeout** and "Checking your camera and microphone…" was one shared state, so a pending/hung device left the page there forever with both tiles on "Camera off". | Reproduced on the old code (hung `getUserMedia`): still `preparing` after 10 simulated minutes. |
| 2 | Every effect re-run (React Strict Mode, *Try again*, quick re-entry) opened the camera **again while the previous request was still pending** - concurrent opens of one physical camera. | Code path; now one in-flight request per tab (unit + browser tests assert `getUserMedia` call counts). |
| 3 | A join that was cancelled mid-flight could still set `joined`, start a heartbeat **timer that was never cleared**, and leave the socket in the room with nobody owning it. | Code path (fixed: ownership token per run). |
| 4 | Reconnect logic could restart the WebRTC offer repeatedly with no upper bound. | Code path (fixed: grace period + max 4 recoveries, then a clear error + *Try again*). |
| 5 | One combined camera+mic request: a failure could not say **which** device was the problem; remote tile said "Camera off" while simply waiting for the student. | UI (fixed: per-device messages, honest placeholders and status line). |

## What could NOT be reproduced
`STATUS_ACCESS_VIOLATION` ("Aw, Snap!") is a **native Chromium renderer crash**; JavaScript cannot cause it directly. It was not reproduced with Chromium's fake devices, and with the healthy path the old and new code both complete real two-way WebRTC. Defects 1-4 are the verified application problems that leave a page hanging on the media stack; a crash that remains after this fix, on one machine only, points to that machine's camera/virtual-camera driver, GPU driver or a browser extension. Mitigations: lighter capture (640x480@24 instead of 1280x720), no concurrent camera opens, bounded retries. Diagnostic: `window.__interviewDiag` (last 100 state transitions, no tokens/personal data) and `console.info('[interview]' ...)`.
If it still happens: open `chrome://gpu` and `chrome://crashes`, try with *Use graphics acceleration when available* off, disable virtual-camera software (OBS, ManyCam, Snap Camera) and extensions, update the camera/GPU driver, and send `window.__interviewDiag`.

## How it works now
`frontend/src/services/interviewMedia.ts` - reference-counted single-flight media pool: finite waits (permission hint after 1.5 s, hard stop at 45 s), per-device classification, immediate "no camera/microphone" from `enumerateDevices`, late streams stopped, hung requests never reused.
`frontend/src/hooks/useInterviewRoom.ts` - phases `preparing → awaiting-permission → media-error | joining → waiting-peer → connecting → connected ⇄ reconnecting → ended | error`; every async step checks `alive()`; cleanup is idempotent and releases only what this run owns; only this interview's room is left.
Server: join/leave of one socket are serialised.

## Manual verification (two browsers, two accounts)
1. Student requests the interview; teacher **Accepts**.
2. Teacher opens `/teacher/interview/<id>`: within seconds status shows Camera: ready, Microphone: ready, own preview visible; tile says "Waiting for <student> to join…".
3. Student opens the interview: both see and hear each other; toggle mic/camera on both sides.
4. Block the camera in the teacher's browser (lock icon) and reload: "Camera needed - Unable to access your camera…" + *Try again*; allow and retry.
5. Refresh the teacher page mid-call: it reconnects, interview status unchanged, no duplicate interview.
6. **End Interview & Evaluate**: the call closes for both, evaluation form opens (5 × 10 = 50); submit.
7. Repeat steps 1-3 with a second teacher/student pair at the same time; end one - the other keeps running.
Automated: `npm run test:unit`, `npm run test:e2e:media` (real Chromium + WebRTC with fake devices), `npm run test:e2e`.
