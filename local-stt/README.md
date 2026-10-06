# LearnIQ local speech-to-text (faster-whisper)

> **LOCAL DEVELOPMENT ONLY. ENGLISH ONLY (for now).** Production keeps using OpenAI Realtime. The backend refuses this mode when `NODE_ENV=production`.

A tiny service that turns the student's microphone into text **on your own computer**, so you can test the whole AI Interview for ₹0 without OpenAI Realtime credit.
The browser streams the microphone to it over a WebSocket; it answers with live ("partial") text while the student speaks and one **final** text for every spoken turn.
The interview page sends only the final text to the LearnIQ backend, exactly as it does with OpenAI.

## What it guarantees

| | |
|---|---|
| Reachable from | **this computer only** — it listens on `127.0.0.1` (there is no option to change that) |
| Who may connect | browser pages from the Vite dev server (`http://localhost:5173`, `http://127.0.0.1:5173`, and the preview port 4173); other websites are refused |
| Audio | processed in memory and thrown away — **never written to disk**, never sent anywhere |
| Transcripts | never written to disk and never logged (the log only shows how long a turn was and how many characters came back) |
| Network | none while it runs. The **one-time download of the model weights** (from Hugging Face) happens the first time a model is used; `--offline` forbids even that |
| Language | English only. A page asking for another language gets a clear error |

## Install (Windows, PowerShell)

You need Python 3.9 – 3.12 (`python --version`). From the repository root:

```powershell
cd D:\Learniq\local-stt
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py --download-only      # optional: downloads the model now (about 150 MB for base.en)
```

If PowerShell refuses to run the activation script, run `Set-ExecutionPolicy -Scope Process Bypass` once in that window, or use `.venv\Scripts\activate.bat` in `cmd`.

## Turn it on (your own `backend\.env`)

Add these lines to **`backend\.env`** (never to the frontend, never to Render) and restart the backend:

```ini
AI_INTERVIEW_STT_PROVIDER=local
LOCAL_STT_URL=ws://127.0.0.1:8765
LOCAL_STT_MODEL=base.en
AI_INTERVIEW_LANGUAGE=en
```

`LOCAL_STT_URL` must point at **this computer** (`127.0.0.1`, `localhost` or `[::1]`) — anything else is refused, so the microphone can never be streamed to a remote host.
Remove the first line (or set it to `openai`) to go back to OpenAI Realtime.

## Run it

Three terminals:

```powershell
cd D:\Learniq\local-stt ; .venv\Scripts\Activate.ps1 ; python server.py   # this service  -> "listening on ws://127.0.0.1:8765"
cd D:\Learniq\backend  ; npm run dev                                       # LearnIQ backend
cd D:\Learniq\frontend ; npm run dev                                       # LearnIQ frontend
```

Start the speech-to-text service **before** opening the interview page. If it is not running the page shows its normal "try again" screen (and records a technical failure, so a student's attempt is not used up).
Keep Ollama running too if you use `AI_INTERVIEW_PROVIDER=ollama`.

## Choosing a model

| Model | Notes |
|---|---|
| `base.en` (default) | small and quick, fine on a laptop CPU; the safe first choice |
| `small.en` | noticeably more accurate (important for accents and children's voices), roughly 2–3× slower |
| `tiny.en` | fastest, least accurate |

Start the service with the same model name as `LOCAL_STT_MODEL`: `python server.py --model small.en` (or set the `LOCAL_STT_MODEL` environment variable in that terminal).
The backend's `LOCAL_STT_MODEL` is informational; the service uses the model it was started with. The first line of its log shows the model and device it actually loaded.

**CPU is the default** (`--device cpu`, int8): it works everywhere. A GPU is optional and not assumed. If you want to try an NVIDIA card (`--device cuda`) you need the CUDA 12 and cuDNN 9 runtime
libraries described in the [faster-whisper README](https://github.com/SYSTRAN/faster-whisper#gpu); on a 6 GB card that already holds the Ollama model the CPU is the safer first choice.
Other options: `python server.py --help` (`--port`, `--beam-size`, `--allowed-origin`, `--offline`, `--log-level`; the same names exist as `LOCAL_STT_*` environment variables).

## What to expect

* Live text updates about once a second while the student speaks; it is approximate and may change. The **final** text is the one that counts.
* About 0.5–2 s between the end of an answer and its text on a typical laptop CPU (not measured on your machine yet — try `base.en`, then `small.en`).
* An answer ends after a pause (1.4 s by default: `AI_INTERVIEW_END_OF_ANSWER_SILENCE_MS`).
* Accents, children's voices, background noise and speaker echo reduce accuracy; use headphones while testing.
* A noise that is not a word (a cough) makes no text: the interview then gives its normal "take your time" prompt after about 10 seconds.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Interview page says "Something went wrong" right after the microphone prompt | the service is not running, or `LOCAL_STT_URL` has a different port than `--port` |
| `could not load the model` in the service window | no internet for the first download (run `--download-only` once while online), or on a CUDA error use `--device cpu` |
| Service log shows `rejected a connection from origin …` | the page is not served from an allowed origin: start it with `--allowed-origin http://localhost:3000` |
| `AI_INTERVIEW_LANGUAGE (local speech-to-text is English-only …)` in the backend log | set `AI_INTERVIEW_LANGUAGE=en` |
| Text is wrong or missing | try `--model small.en`, use headphones, speak close to the microphone |

## Protocol (for developers)

WebSocket on `ws://127.0.0.1:8765`.

| Direction | Message |
|---|---|
| client → server | text `{"type":"start","sampleRate":16000,"language":"en","silenceMs":1400}` (first message) |
| server → client | text `{"type":"ready","model":"base.en","device":"cpu","sampleRate":16000}` |
| client → server | binary: signed 16-bit little-endian PCM, mono, 16 kHz (the page sends 40 ms chunks, only while the interviewer is listening) |
| client → server | text `{"type":"listening","on":true\|false}` — every change starts the next turn from a clean slate and drops results still being computed |
| server → client | text `speech_started`, `partial` (`text`), `speech_stopped`, `final` (`text`), `transcription_failed`, `error` (`code`) |

## Tests

```powershell
python -m unittest -v test_server
```

They use a fake model and synthetic audio, so they need no download and no microphone. They check the loopback-only binding, the origin check, turn detection, the message order, that nothing is written to disk and that transcripts are never logged.
The browser side is covered by `npm run test:aiinterview` in `backend`.
