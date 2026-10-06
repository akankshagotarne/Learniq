# LearnIQ AI Interview

A short, spoken, real-time interview that is **included with a purchased Olympiad exam**. A friendly avatar asks the student
one question at a time (easy → harder), listens through the microphone, shows live subtitles, and ends with a score and feedback.

There is **one entry point**: the button **"🤖 Start AI Interview"** directly under **"Start Exam"** on the exam card
(Exams page). There is no sidebar item and no second exam page.

---

## 1. How access works (server-side, always)

| Card state (from the backend) | What the student sees |
|---|---|
| Exam not purchased | `🔒 Purchase exam to unlock AI Interview` (no button) |
| Purchased, interview not used | `🤖 Start AI Interview` |
| Clicked, server is preparing | `⏳ Starting AI Interview...` |
| Interview started but not finished | `🤖 Resume AI Interview` |
| Interview completed | `✓ AI Interview Completed` + `View Result` |

Access is granted only when **all** of these are true on the server (`services/aiInterview/entitlement.js`):

1. the request is authenticated and the user's role is `student`;
2. the exam exists and is published;
3. an `OlympiadPayment` with `status: 'SUCCESS'` (verified Razorpay payment) exists for **this student and this exam**;
4. the student's single interview for this exam has not been completed.

Anything else returns `403` (no purchase) or `409` (already completed: *"Your AI Interview for this exam has already been completed."*).
The browser never sends or decides the student id, standard, exam data, price, status, score, question count or time limit.

**One interview per purchase** is enforced by a unique database index on `(student, exam)`. The collection also stores `attempt`,
`restarts` and `board` so retakes, several interviews per exam or teacher-created interviews can be added later by relaxing that one index.

### Entitlement: exactly ONE attempt
A successful exam purchase gives **one** AI Interview attempt. The attempt is consumed **when the first question has been presented to the
student** - not when the page opens, not when the clock starts. Everything is decided on the server (`services/aiInterview/stateMachine.js`,
`endingFor`):

1. The student clicks *Start AI Interview*, the interview page opens, and the browser connects the avatar, OpenAI transcription and the
   microphone (technical initialisation). Nothing is consumed.
2. The browser calls `POST /api/ai-interviews/:id/begin`: the server starts the clock and generates question 1. Still nothing is consumed.
3. The avatar speaks the greeting and question 1. Only when that has **succeeded** does the browser call
   `POST /api/ai-interviews/:id/question-presented { questionId: "q1" }`. The server then sets `attemptConsumed = true`,
   `firstQuestionPresentedAt` and `consumedAt` (idempotent; only `q1` counts). A student turn on the question (answer, "I don't know",
   silence, repeat) also implies it, so a lost confirmation can never become a free retry.

| Situation | Result |
|---|---|
| Start clicked, then avatar / OpenAI / microphone / server fails before question 1 is spoken | **Not consumed**; can start again |
| Interview page opens and the student leaves or ends it before the first question is presented (also: clock runs out before it) | **Not consumed** (`cancelled`, reason `not_presented`); can start again |
| First question presented, student exits without answering | **Consumed** (`completed`, `insufficient_answers`); no retry |
| Any real answer | **Consumed** |
| Student says "I don't know" | **Consumed** |
| First question presented, student stays silent until the configured time limit | **Consumed** (`completed`, `insufficient_answers`) |
| First question presented, then a clearly technical failure (OpenAI / avatar / server / browser / WebRTC / microphone) and **no real answer** | **Given back** (`cancelled` or `error`, `attemptConsumed` back to `false`); can start again |
| Normal abandonment | **Never** a free retry |

* A real answer always wins: once the student has really answered, no later "technical" report can turn it back into a retry.
* "Clearly technical" means the server saw a provider / server failure (`aiFailures`, `connectFailures`, or a server-side `failed` ending) or the
  browser reported a microphone, transcription or avatar-connection failure (`usage.micFailures`, `transcriptionFailures`, `avatarDisconnects`).
* `cancelled` / `error` can only go back to `created` (technical restart); `completed` is final.
* **Cost guard:** technical restarts are capped by `AI_INTERVIEW_MAX_TECHNICAL_RETRIES` (default 5). It only bounds provider cost; it is not an
  extra attempt. When it is reached the card shows the interview as unavailable (HTTP 409 `INTERVIEW_UNAVAILABLE`).
* **Limits of what the server can know:** whether the avatar really spoke and whether a microphone failed are reported by the browser, so they
  cannot be verified. They can never give back an attempt once a real answer exists, and abuse is bounded by the cost guard above.

## 2. Architecture

```
Browser (Vercel)                                   Backend (Render)                       Providers
──────────────────────────────                     ───────────────────────────            ───────────────────
Exam card button ── GET  /api/ai-interviews/exams/:id/status
                 ── POST /api/ai-interviews/start ───────► validates purchase, creates/returns the session
Interview page   ── POST …/:id/realtime-session ─────────► mints SHORT-LIVED credentials ─► OpenAI client secret
                                                                                          ─► LiveAvatar session token
                                                       (local STT mode: returns the local service address instead of an OpenAI secret)
                 ── mic ──► OpenAI Realtime (WebRTC, live transcription only)
                    (development only: mic ──► local faster-whisper on THIS computer, ws://127.0.0.1:8765 — §4b)
                 ── avatar video/voice ◄── HeyGen LiveAvatar (LiveKit) — speaks only text WE send (speak_text); its voice chat is MUTED
                 ── POST …/:id/begin ────────────────────► starts the server clock, returns greeting + Q1
                 ── POST …/:id/question-presented {q1} ─────► Q1 was spoken: THE attempt is consumed here
                 ── POST …/:id/answer {FINAL transcript} ─► one OpenAI call: judge answer + write next question
                 ── POST …/:id/complete ─────────────────► "End Interview"
Result page      ── GET  …/:id/result
```

* **Backend = source of truth.** Status, question list, answers, scores and the clock live in the `AIInterview` document.
  The frontend can't force a state transition: every call performs one fixed transition using an atomic compare-and-set on the current status.
* **AI layer** (`services/aiInterview/AIInterviewService.js`) is the only code that knows prompts. It calls OpenAI with strict JSON schemas and
  **validates every reply** (malformed / unsafe output is rejected, text is stripped of HTML and links, scores are clamped).
* **Who does what:** **OpenAI is the interviewer** (questions, evaluation, follow-ups, scoring inputs, final feedback, and the live transcription of the
  student's voice). **LiveAvatar is only the face and voice**: it says the exact text our server produced and nothing else. LiveAvatar's own LLM is never used:
  the browser only calls the SDK's `repeat()` (the LLM-free `avatar.speak_text` command), never `message()` (`avatar.speak_response`, which would make
  LiveAvatar's LLM answer), the session is `PUSH_TO_TALK`, and the token request carries no `llm_settings`, `llm_configuration_id` or `dynamic_variables`.
* **Microphone handling (two separate things):**
  1. *Our* microphone capture (`useOpenAITranscription`) streams to **OpenAI only**, for live transcription, and is enabled only while the interviewer is listening.
     (In local development mode, §4b, `useLocalTranscription` streams it to a service on the same computer instead — the audio still goes nowhere else.)
  2. The LiveAvatar SDK's default is a live voice chat that opens the microphone and publishes it to the LiveAvatar room. LearnIQ therefore creates the
     session with `voiceChat: { defaultMuted: true }`: the SDK still creates its own local audio track (a second capture of the same microphone, hence one
     permission prompt only), but it is **muted from the start and never unmuted**, so **no microphone audio is sent to LiveAvatar**.
  The AI never sees the exam's questions or answer key, never computes the final grade (the server does) and treats the student's speech as untrusted data.
* **Avatar layer** (`services/avatar/AvatarService.js`) is provider-neutral; HeyGen LiveAvatar lives in `liveAvatarProvider.js`
  (server: mint a token) and `frontend/src/hooks/useLiveAvatar.ts` (browser: connect / speak / interrupt / stop).
  Swapping providers means adding one file on each side.
* **State machine** (`stateMachine.js`): `created → initializing → greeting → asking_question ⇄ listening → processing_answer → evaluating → next_question → completed`
  (plus `cancelled` and `error`).
* **Scoring** (`scoring.js`): each answer is scored 0–10 by the evaluation; percentage, grade (A+ ≥ 90, A ≥ 80, B+ ≥ 70, B ≥ 60, C ≥ 40, D), pass mark
  (default 60%), strengths and areas to improve are computed by the server. Questions never reached count as 0, so ending early cannot raise a score.
  A silent skip (`no_response`, usually a microphone problem) is not counted as a wrong answer. Fewer than 3 genuine attempts → "not enough answers", no grade.
* **Special speech:** "I don't know" → `answered: false`, reason `student_does_not_know`, score 0, no evaluation call.
  Silence → *"Take your time. Would you like me to repeat the question?"* (twice, then the question is skipped). "Repeat that" → same question, no AI call.
  Live subtitles are LIVE (italic, badge) until the FINAL transcript arrives; **only the final transcript is sent and saved**.

### API (all under `/api/ai-interviews`, all require login; errors are `{ success:false, message, code }`)

| Method & path | Purpose |
|---|---|
| `GET  /exams/:examId/status` | card state (locked / available / in_progress / completed / unavailable) |
| `POST /start` `{ examId }` | validate purchase, create or resume the session |
| `GET  /:id` | current state (no scores) |
| `POST /:id/realtime-session` | short-lived transcription secret + avatar token (max 4 per interview) |
| `POST /:id/begin` | "avatar + mic ready": start the clock, greeting + question 1 (or resume). Consumes nothing |
| `POST /:id/question-presented` | "question 1 has been spoken to the student": **consumes the attempt** (idempotent) |
| `POST /:id/answer` `{ questionId, transcript?, kind? }` | one turn (`kind`: `answer` \| `silence` \| `repeat`) |
| `POST /:id/complete` | End Interview (scores what was answered) |
| `GET  /:id/result` | final result (only when completed) |
| `POST /:id/events` `{ type }` | connection-health analytics only |
| `GET  /admin/stats` | admin-only aggregate numbers (completion rate, average score, AI calls, connection issues) |

## 3. Environment variables (backend only)

Set these in `backend/.env` locally and in **Render → Environment** in production. **Never** prefix them with `VITE_` and never put them in Vercel.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `OPENAI_API_KEY` | yes (not needed when **both** the Ollama brain §4a and local speech-to-text §4b are used) | – | OpenAI secret key (server only) |
| `LIVEAVATAR_API_KEY` (alias `HEYGEN_API_KEY`) | yes | – | HeyGen LiveAvatar API key |
| `HEYGEN_AVATAR_ID` | yes | – | avatar id from the LiveAvatar dashboard |
| `HEYGEN_VOICE_ID` / `HEYGEN_CONTEXT_ID` | no | – | optional; sent **inside `avatar_persona`** only when set (empty = the avatar's default voice / no context) |
| `LIVEAVATAR_SANDBOX` | no | `false` | `true` = free test mode: one fixed avatar and an avatar session limited to **60 seconds** (the interview's own 7-minute limit is unchanged) |
| `AI_INTERVIEW_ENABLED` | no | `true` | `false` hides/blocks the feature everywhere |
| `AI_INTERVIEW_MAX_QUESTIONS` | no | `8` | 3–12 |
| `AI_INTERVIEW_MAX_DURATION_SECONDS` | no | `420` | 120–1800 (server clock) |
| `AI_INTERVIEW_PASS_PERCENTAGE` | no | `60` | pass mark |
| `AI_INTERVIEW_MAX_TECHNICAL_RETRIES` | no | `5` | 0–10; cost guard for re-starts after purely technical failures (not a student allowance) |
| `AI_INTERVIEW_PROVIDER` | no | `openai` | interviewer brain: `openai` (production) or `ollama` (**local development only**, refused when `NODE_ENV=production`); only the exact value `ollama` selects Ollama |
| `OLLAMA_BASE_URL` | no | `http://localhost:11434` | local Ollama server (used only when `AI_INTERVIEW_PROVIDER=ollama`) |
| `OLLAMA_MODEL` | no | `gemma3:4b` | local model for questions / evaluation / feedback |
| `OLLAMA_REQUEST_TIMEOUT_MS` | no | `60000` | timeout of one local model call (3000–300000) |
| `AI_INTERVIEW_MODEL` | no | `gpt-4.1-mini` | OpenAI model for questions / evaluation |
| `AI_INTERVIEW_STT_PROVIDER` | no | `openai` | speech-to-text: `openai` (OpenAI Realtime, production) or `local` (faster-whisper, **local development only, English only**, refused when `NODE_ENV=production`); only the exact value `local` selects it |
| `LOCAL_STT_URL` | no | `ws://127.0.0.1:8765` | local speech-to-text service (used only when `AI_INTERVIEW_STT_PROVIDER=local`); must be a `ws://` address on this computer |
| `LOCAL_STT_MODEL` | no | `base.en` | faster-whisper model name (informational for the page; the service loads the model it was started with) |
| `AI_INTERVIEW_TRANSCRIBE_MODEL` | no | `gpt-4o-mini-transcribe` | live speech-to-text model |
| `AI_INTERVIEW_LANGUAGE` | no | `en` | spoken language hint |
| `AI_INTERVIEW_SILENCE_TIMEOUT_MS` | no | `15000` | silence before the "Take your time" prompt |
| `AI_INTERVIEW_END_OF_ANSWER_SILENCE_MS` | no | `1400` | pause that ends an answer |
| `AI_INTERVIEW_AI_TIMEOUT_MS` / `AI_INTERVIEW_AVATAR_TIMEOUT_MS` | no | `20000` / `15000` | provider request timeouts |
| `OPENAI_BASE_URL`, `LIVEAVATAR_API_URL` | no | official URLs | only for proxies / testing |

If a required key is missing the student sees *"The AI Interview is not available right now."* and the server logs only the **names** of the missing settings.
No fake interview, avatar, voice, subtitles or score is ever produced. There is no admin settings screen in LearnIQ, so configuration is environment-based.

## 4. Provider setup

**OpenAI** – create a key at <https://platform.openai.com/api-keys>, add it as `OPENAI_API_KEY`. The interview uses Chat Completions with
structured outputs (questions / evaluation) and the Realtime API in *transcription* mode (live subtitles). Check your account has access to the models above.

**HeyGen LiveAvatar** – HeyGen's older Interactive Avatar API was retired; LearnIQ uses its successor **LiveAvatar**. Create an account at
<https://www.liveavatar.com>, create an API key and pick an avatar; set `LIVEAVATAR_API_KEY` and `HEYGEN_AVATAR_ID`.
Use `LIVEAVATAR_SANDBOX=true` first to test without spending credits (one fixed avatar, sessions of about one minute).
The server mints the session token with this request (`POST https://api.liveavatar.com/v1/sessions/token`, `X-API-KEY` header; values shown are placeholders):

```json
{
  "mode": "FULL",
  "avatar_id": "<HEYGEN_AVATAR_ID>",
  "interactivity_type": "PUSH_TO_TALK",
  "is_sandbox": true,
  "max_session_duration": 60,
  "video_settings": { "quality": "medium", "encoding": "H264" },
  "avatar_persona": { "language": "en", "voice_id": "<only if HEYGEN_VOICE_ID is set>", "context_id": "<only if HEYGEN_CONTEXT_ID is set>" }
}
```

LiveAvatar requires **exactly one** of `avatar_persona` / `voice_agent` (otherwise HTTP 422 *"Provide exactly one of avatar_persona or voice_agent"*), and
`voice_id`, `context_id` and `language` are only valid *inside* it. LearnIQ uses the inline `avatar_persona` for now; a stored `voice_agent` may replace it
later. Without a context LiveAvatar treats an avatar as being in "restricted mode" (it will not answer users); that is irrelevant to LearnIQ because the avatar only
speaks our text, but if the avatar ever stays silent in the sandbox test, create a context in the LiveAvatar dashboard and set `HEYGEN_CONTEXT_ID`.

**Session duration (`max_session_duration`).** This is the *avatar* session length on LiveAvatar's side, a cost-control hard cap. It is separate from the
interview duration (`AI_INTERVIEW_MAX_DURATION_SECONDS`, default 420 s = 7 minutes), which is measured by our server clock and is never changed by sandbox mode.

| Mode | `max_session_duration` sent to LiveAvatar |
|---|---|
| `LIVEAVATAR_SANDBOX=true` | **60 seconds** (LiveAvatar's sandbox maximum; a longer value is rejected with HTTP 400 *"max_session_duration (…s) exceeds the maximum allowed (60s)"*) |
| `LIVEAVATAR_SANDBOX=false` (production) | the configured interview duration **+ 90 s** grace (default 420 + 90 = 510 s), subject to the limit of your LiveAvatar plan / account (a value above it is rejected by the provider) |

Consequence for testing: a sandbox avatar session ends after about one minute, so a **full 7-minute interview cannot be completed in sandbox mode**. Use sandbox to verify
the connection, the avatar video and voice, and the first question(s). The page treats the end of the avatar session as a connection drop and tries to reconnect
(up to 2 times, each minting another free sandbox session); a complete run needs `LIVEAVATAR_SANDBOX=false` and LiveAvatar credits.

## 4a. Local Ollama AI-brain mode (development only)

> **LOCAL DEVELOPMENT ONLY.** Ollama replaces the interviewer's *brain* only. Speech-to-text is a separate switch: it uses OpenAI Realtime unless you also turn on the local faster-whisper mode (§4b).

**What it does.** With `AI_INTERVIEW_PROVIDER=ollama` the four brain operations — first question, answer evaluation + next question, next question after
"I don't know" / silence, and the closing feedback — are answered by a model running on your own computer through Ollama's `/api/chat` endpoint
(₹0, no API key). The prompts, JSON schemas (sent to Ollama as `format`), validators, scoring, state machine, entitlement and payment logic are the **same code** as with OpenAI;
only `services/aiInterview/ollamaClient.js` is different. Everything the model says is still validated and sanitised before it is used.

**What it does not do.**

* **Speech-to-text is a separate setting.** By default live transcription (the student's spoken answers → text) still uses **OpenAI Realtime**, so `POST /:id/realtime-session` then needs a working
  `OPENAI_API_KEY` **with credit**. For a fully free local test also use the local faster-whisper mode, §4b.
* **LiveAvatar is unchanged.** The avatar still needs `LIVEAVATAR_API_KEY` / `HEYGEN_AVATAR_ID` (sandbox is free).
* It never runs in production: with `NODE_ENV=production` and `AI_INTERVIEW_PROVIDER=ollama` the interview refuses to start with a configuration error
  (the server log shows `AI_INTERVIEW_PROVIDER=ollama is local-development only and is not allowed when NODE_ENV=production`; the student sees "not available right now").
* Any value other than `ollama` (or no value) means OpenAI, so production behaviour does not change.

**Set it up (local `backend/.env` only).**

```bash
ollama pull gemma3:4b          # once
ollama serve                   # if it is not already running (default http://localhost:11434)
```

```ini
AI_INTERVIEW_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:4b
OLLAMA_REQUEST_TIMEOUT_MS=60000
```

Restart the backend after changing `.env`. In Ollama mode `problems()` requires a valid `OLLAMA_BASE_URL` and `OLLAMA_MODEL` for the brain. `OPENAI_API_KEY` is still required
while speech-to-text is OpenAI Realtime (the default, `AI_INTERVIEW_STT_PROVIDER=openai`); it is only dropped when local speech-to-text §4b is
used as well (the avatar settings are always required). To go back to OpenAI, remove the line or set `AI_INTERVIEW_PROVIDER=openai`.

**Expect with a small local model.** Replies take longer than OpenAI (raise `OLLAMA_REQUEST_TIMEOUT_MS` on a slow CPU) and `gemma3:4b` sometimes breaks the format or asks a weaker question.
A malformed reply is rejected by the existing validators (`BAD_OUTPUT`, logged as provider `ollama`) and counted as a technical failure, exactly like an OpenAI failure — it never produces a fake score.

**Troubleshooting.** `NETWORK` (detail `ECONNREFUSED`) = Ollama is not running; `MODEL_NOT_FOUND` (HTTP 404) = run `ollama pull gemma3:4b`; `TIMEOUT` = raise `OLLAMA_REQUEST_TIMEOUT_MS`.
Look for `[ai-interview] provider_failure {"provider":"ollama",…}` in the backend log.

## 4b. Local faster-whisper speech-to-text (development only, English only)

> **LOCAL DEVELOPMENT ONLY. ENGLISH ONLY for now.** OpenAI Realtime remains the default and the production option; nothing about it was removed or changed.

**What it does.** With `AI_INTERVIEW_STT_PROVIDER=local` the student's microphone is transcribed by a small service you run on your own computer (`local-stt/`, faster-whisper) instead of OpenAI Realtime.
Together with the Ollama brain (§4a) and the free LiveAvatar sandbox this makes a complete interview cost ₹0 to test.

**How it works.**

1. `POST /:id/realtime-session` no longer mints an OpenAI secret. It returns `stt: { provider: 'local', url, model, language: 'en', silenceDurationMs }` (the OpenAI answer is
   `stt: { provider: 'openai', clientSecret, callsUrl, … }`, unchanged apart from the new `provider` label). The avatar token is issued exactly as before.
2. The interview page chooses its transcription hook from `stt.provider` (`useOpenAITranscription` or `useLocalTranscription`); there is no frontend environment variable for this.
   Both hooks expose the same callbacks (`onSpeechStart`, `onPartial` = live text, `onFinal` = final text of a turn, `onConnectionLost`, `onTranscriptionFailed`), so the question loop,
   the state machine, entitlement and scoring are identical. Only **final** text is sent to the backend and saved.
3. The browser streams 16 kHz mono audio, only while the interviewer is listening, over a WebSocket to `ws://127.0.0.1:8765`.
   **The audio goes to nobody else**: not to this backend, not to LiveAvatar, not to any third party, and it is never stored (the service keeps it in memory and discards it; transcripts are never logged).

**Safety rails (all tested).**

* `NODE_ENV=production` with `AI_INTERVIEW_STT_PROVIDER=local` is **refused**: the interview does not start (503 "not available right now"; the server log names the reason).
* `LOCAL_STT_URL` must be a `ws://` / `wss://` address on this computer (`127.0.0.1`, `localhost`, `[::1]`), with no credentials in it; otherwise the interview does not start. The microphone can never be streamed to a remote host.
* `AI_INTERVIEW_LANGUAGE` must be `en` in local mode (the first implementation only understands English). OpenAI Realtime keeps supporting `hi` / `mr`.
* The service listens on `127.0.0.1` only and refuses browser pages that are not the dev server.

**Set it up.** Follow [`local-stt/README.md`](../local-stt/README.md) (Python virtual environment, `pip install -r requirements.txt`, `python server.py`), then add to your own `backend/.env`:

```ini
AI_INTERVIEW_STT_PROVIDER=local
LOCAL_STT_URL=ws://127.0.0.1:8765
LOCAL_STT_MODEL=base.en
AI_INTERVIEW_LANGUAGE=en
```

**Expect.** The default model `base.en` runs on the CPU (no GPU is assumed); `small.en` is more accurate and slower. Live text is approximate, the final text counts, and the first run downloads the model once.
If the service is not running the interview page shows its normal "try again" screen and records a technical failure, so a student's attempt is not used up.

**Troubleshooting.** See the table in `local-stt/README.md`. In the backend log, `AI_INTERVIEW_STT_PROVIDER=local is local-development only…` means `NODE_ENV=production`; `LOCAL_STT_URL (must be a ws:// address on this computer…)` means the address is wrong.

## 5. Run it locally

```bash
cd backend && npm install && npm run dev     # with OPENAI_API_KEY / LIVEAVATAR_API_KEY / HEYGEN_AVATAR_ID in backend/.env
cd frontend && npm install && npm run dev
```

Log in as a student whose exam payment is `SUCCESS`, open **Exams**, and use **🤖 Start AI Interview** under **Start Exam**.
The microphone works on `http://localhost` and on HTTPS only. Use a recent Chrome, Edge or Safari; headphones reduce echo.

## 6. Deployment

* **Render (backend):** add the variables above in *Environment* and redeploy. `CLIENT_URL` must be the exact Vercel URL (CORS allow-list, no `*`).
  The existing `trust proxy = 1` setting is reused, so the per-user rate limits work behind Render's proxy.
* **Vercel (frontend):** only `VITE_API_URL` is needed. **No AI key is ever a `VITE_` variable** – the frontend build refuses `*SECRET*` names.
  The new dependency `@heygen/liveavatar-web-sdk` is installed by `npm install`; the interview page is lazy-loaded, so other pages are not slower.
* The browser connects directly to OpenAI (WebRTC) and LiveAvatar (LiveKit); make sure no network policy blocks those hosts.

## 7. Security, privacy, cost

* Auth + ownership check on every call (another student's interview id returns 404); input validation; 8 KB body limit; per-user rate limits; provider timeouts; CORS allow-list; structured logs without secrets.
* Only **short-lived** credentials reach the browser (OpenAI client secret, LiveAvatar session token). API keys, avatar ids and provider session ids never do.
* **No audio is stored or sent to LearnIQ servers.** The microphone audio goes only to OpenAI for transcription (or, in local development mode, to the faster-whisper service on the same computer) and **none is sent to LiveAvatar** (its voice chat is created muted); only the **final** answer text is saved.
  The page tells the student: *"Your microphone is used to hear your answers during the interview."* The microphone is switched on only while the interviewer is listening.
  The prompts are written for school-age students (friendly, age-appropriate, no personal questions).
* Cost controls: one interview per purchase, 8 questions, 7 minutes (server clock), **one** model call per answered question, compact prompts, only the next question is generated,
  hard ceiling of `questions + 6` model calls, max 4 credential mints per interview, provider-side session cap (`max_session_duration`).

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "The AI Interview is not available right now." | a required env var is missing (check the Render log for `[ai-interview] not_configured`), or `AI_INTERVIEW_ENABLED=false` |
| "Microphone access is required…" | browser permission blocked: use the lock icon in the address bar, allow the microphone, press *Try again* |
| Avatar never appears / "Something went wrong" | wrong `HEYGEN_AVATAR_ID`, LiveAvatar credits used up, or a blocked network; see `[ai-interview] provider_failure` in the log |
| Subtitles stay empty | transcription connection blocked (firewall / VPN) or unsupported model name in `AI_INTERVIEW_TRANSCRIBE_MODEL`; in local mode the `local-stt` service is not running (§4b) |
| "Too many connection attempts" | more than 4 credential mints for one interview; wait and use *Try again* |
| Card shows the lock | no `SUCCESS` payment for that exact exam on that student's account |

### 8a. Speech-to-text troubleshooting ("I'm listening…" but nothing appears in YOU)

The path is: microphone → OpenAI Realtime (WebRTC) → transcript → the YOU box → backend. The browser can show you where it stops.

1. In the interview page's browser console run `localStorage.setItem('learniq_stt_debug','1')`, reload, and start the interview (or open the page with `?sttdebug=1`).
   Lines beginning `[LearnIQ STT]` appear (also kept in `window.__learniqStt.log`; counters of every OpenAI event in `window.__learniqStt.events`). Nothing is printed unless you switch this on, and it never prints a key or client secret.
2. Read the `status` lines while you speak:
   - `mic.enabled:false` or `senderTrackEnabled:false` while `listening:true` → the microphone track is muted (the page prints a WARNING).
   - `packetsSinceLast:0` → no audio is leaving the browser; `micLevel` near 0 for 6 s → the browser hears nothing (Windows input device, mute, privacy settings).
   - `peer`/`ice` not `connected`, or `dataChannel` not `open` → the WebRTC connection to OpenAI is down.
3. Look at the events: `input_audio_buffer.speech_started` / `speech_stopped` mean OpenAI heard you. Then expect `conversation.item.input_audio_transcription.delta` and `.completed`.
   If you see `transcription FAILED` the line carries OpenAI's own error `type` / `code` / `message`, and the YOU box shows *"I couldn't turn your voice into text just now. Please try again."*
   The same code is written to the backend log: `[ai-interview] client_event {"id":"…","type":"stt_error","detail":"insufficient_quota"}`.
4. The most common cause when audio is flowing but transcription fails is the **OpenAI account**: `insufficient_quota` = no credit (add credit at platform.openai.com → Billing; a key without credit still creates the call, `calls` → 201, but nothing is transcribed), `invalid_api_key` / `model_not_found` = check `OPENAI_API_KEY` and `AI_INTERVIEW_TRANSCRIBE_MODEL`.
   Free alternative for local development only: `AI_INTERVIEW_STT_PROVIDER=local` (§4b).
5. If the student stops speaking and no transcript arrives within 10 s (a cough, a noise, a slow or failed transcription), the interview treats it as silence and moves on instead of waiting for ever.
6. After editing `backend/.env` stop and start the backend (`npm run dev` does not watch `.env`).

## 9. Tests

```bash
cd backend && npm run test:aiinterview      # 107 tests: entitlement, ownership, state machine, limits, failures, scoring, AI output validation, secrets, LiveAvatar request,
                                            #           AI-brain provider (OpenAI / Ollama), speech-to-text provider (OpenAI / local), local transcription hook + audio worklet, OpenAI transcription hook + diagnostics
cd local-stt && python -m unittest -v test_server   # 23 tests of the local speech-to-text service (fake model, synthetic audio)
```

The tests replace OpenAI, Ollama, the local speech-to-text service and LiveAvatar with local test doubles / a stubbed `fetch` / a fake WebSocket inside the test files only (the production code has no mock mode, and no test contacts a real provider).
The real OpenAI / LiveAvatar connections can only be verified with real keys; do a sandbox run (`LIVEAVATAR_SANDBOX=true`) after configuring them.

## 10. Not included (yet)

* A certificate for the AI Interview (the existing certificate system is tied to the exam result and was deliberately left unchanged).
* An admin settings screen (configuration is via environment variables; `GET /api/ai-interviews/admin/stats` provides the numbers).
* Automatic barge-in: the student can press *"I'm ready to answer"* to interrupt the avatar instead.
