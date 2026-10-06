#!/usr/bin/env python3
"""
LearnIQ local speech-to-text service  --  LOCAL DEVELOPMENT ONLY, ENGLISH ONLY.

The AI Interview page streams the student's microphone to this process over a WebSocket and gets back live ("partial") text while
the student speaks and one "final" text for every spoken turn. It lets you test the whole interview for Rs 0 without OpenAI Realtime.

Guarantees (each is covered by test_server.py):
  * It listens on 127.0.0.1 ONLY (the address is a constant, there is no --host option).
  * Audio is processed in memory and thrown away. Nothing is written to disk. Transcripts are never logged.
  * Nothing is sent to any third-party service. The only network traffic is the optional ONE-TIME download of the model
    weights (Hugging Face) the first time a model is used; `--offline` forbids even that.
  * Only a browser page from an allowed origin (default: the Vite dev server) may connect.

Protocol (WebSocket, one connection per interview page):
  client -> server  text   {"type":"start","sampleRate":16000,"language":"en","silenceMs":1400}   (first message)
  server -> client  text   {"type":"ready","model":"base.en","device":"cpu","sampleRate":16000}
  client -> server  binary little-endian signed 16-bit PCM, mono, 16 kHz (any chunk size)
  client -> server  text   {"type":"listening","on":true|false}   (turn on/off: audio state is reset, in-flight results are dropped)
  server -> client  text   {"type":"speech_started"} | {"type":"partial","text":...} | {"type":"speech_stopped"}
                           {"type":"final","text":...} | {"type":"transcription_failed"} | {"type":"error","code":...}
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import json
import logging
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Deque, List, NamedTuple, Optional

import numpy as np

HOST = "127.0.0.1"          # constant on purpose: this service must never be reachable from another computer
SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME = SAMPLE_RATE * FRAME_MS // 1000   # 320 samples
MAX_CONNECTIONS = 3
DEFAULT_ORIGINS = (
    "http://localhost:5173", "http://127.0.0.1:5173",   # Vite dev server
    "http://localhost:4173", "http://127.0.0.1:4173",   # vite preview
)

log = logging.getLogger("local-stt")


# --------------------------------------------------------------------------------------------------------------------------
# Turn detection: decides when the student starts and stops speaking (no model needed, runs on every 20 ms frame)
# --------------------------------------------------------------------------------------------------------------------------
class Event(NamedTuple):
    kind: str                       # "speech_started" | "endpoint" | "discard"
    audio: Optional[np.ndarray] = None


class TurnDetector:
    """Energy-based voice-activity detection with an adaptive noise floor and hysteresis.

    The browser already applies echo cancellation, noise suppression and automatic gain, so a simple detector is enough here.
    The Whisper model itself also filters non-speech (see FasterWhisperTranscriber), which removes most false triggers.
    """

    def __init__(self, silence_ms: int = 1400, start_threshold: float = 0.012, onset_ms: int = 160,
                 preroll_ms: int = 300, max_turn_ms: int = 30000, min_voiced_ms: int = 160):
        self.silence_frames_needed = max(1, silence_ms // FRAME_MS)
        self.start_threshold = start_threshold
        self.onset_needed = max(1, onset_ms // FRAME_MS)
        self.preroll_frames = (preroll_ms + onset_ms) // FRAME_MS
        self.max_turn_frames = max_turn_ms // FRAME_MS
        self.min_voiced_frames = max(1, min_voiced_ms // FRAME_MS)
        self.reset()

    # -- state ---------------------------------------------------------------------------------------------------------
    def reset(self) -> None:
        self.noise = 0.003
        self.in_speech = False
        self._tail = np.zeros(0, dtype=np.float32)
        self._preroll: Deque[np.ndarray] = collections.deque(maxlen=self.preroll_frames)
        self._onset = 0
        self._utt: List[np.ndarray] = []
        self._silence = 0
        self._voiced = 0

    @property
    def speech_ms(self) -> int:
        return len(self._utt) * FRAME_MS if self.in_speech else 0

    def snapshot(self, max_ms: int = 15000) -> np.ndarray:
        """The audio of the utterance so far (for live partial text), trailing `max_ms` at most."""
        if not self._utt:
            return np.zeros(0, dtype=np.float32)
        frames = self._utt[-(max_ms // FRAME_MS):]
        return np.concatenate(frames)

    # -- input ---------------------------------------------------------------------------------------------------------
    def feed(self, samples: np.ndarray) -> List[Event]:
        events: List[Event] = []
        data = np.concatenate([self._tail, samples.astype(np.float32, copy=False)]) if self._tail.size else samples.astype(np.float32, copy=False)
        n_frames = data.size // FRAME
        for i in range(n_frames):
            self._frame(data[i * FRAME:(i + 1) * FRAME], events)
        self._tail = data[n_frames * FRAME:].copy()
        return events

    def _frame(self, f: np.ndarray, events: List[Event]) -> None:
        rms = float(math.sqrt(float(np.mean(f * f)))) if f.size else 0.0
        if not self.in_speech:
            self._preroll.append(f)
            threshold = max(self.start_threshold, self.noise * 4.0)
            if rms >= threshold:
                self._onset += 1
            else:
                self._onset = max(0, self._onset - 1)
                self.noise = max(1e-4, 0.98 * self.noise + 0.02 * rms)   # learn the background level from quiet frames only
            if self._onset >= self.onset_needed:
                self.in_speech = True
                self._utt = list(self._preroll)
                self._silence = 0
                self._voiced = self._onset
                events.append(Event("speech_started"))
            return

        self._utt.append(f)
        if rms >= max(self.start_threshold * 0.6, self.noise * 2.5):
            self._silence = 0
            self._voiced += 1
        else:
            self._silence += 1
        if self._silence >= self.silence_frames_needed or len(self._utt) >= self.max_turn_frames:
            trailing = max(0, self._silence - 15)           # keep ~300 ms of the pause, drop the rest
            frames = self._utt[:len(self._utt) - trailing] if trailing else self._utt
            audio = np.concatenate(frames) if frames else np.zeros(0, dtype=np.float32)
            voiced = self._voiced
            self.in_speech = False
            self._utt = []
            self._preroll.clear()
            self._onset = 0
            self._silence = 0
            self._voiced = 0
            events.append(Event("endpoint" if voiced >= self.min_voiced_frames else "discard", audio))


# --------------------------------------------------------------------------------------------------------------------------
# Transcription (faster-whisper). Everything here runs on this computer.
# --------------------------------------------------------------------------------------------------------------------------
_NON_SPEECH = re.compile(r"^\s*[\[\(\*♪].*[\]\)\*♪]\s*$")


def clean_text(text: str) -> str:
    """Normalise a model reply; non-speech tags such as [BLANK_AUDIO] or (coughing) become empty."""
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text or _NON_SPEECH.match(text) or not re.search(r"[A-Za-z0-9]", text):
        return ""
    return text


class FasterWhisperTranscriber:
    """Callable: (audio float32 mono 16 kHz, final: bool) -> text. Partials use greedy decoding (fast); finals use a small beam."""

    def __init__(self, model_name: str, device: str = "cpu", compute_type: str = "int8", offline: bool = False, beam_size: int = 3):
        from faster_whisper import WhisperModel  # imported late so the tests can run without the package

        self.model_name = model_name
        self.device = device
        self.beam_size = beam_size
        self.model = WhisperModel(model_name, device=device, compute_type=compute_type, local_files_only=offline)

    def __call__(self, audio: np.ndarray, final: bool) -> str:
        segments, _info = self.model.transcribe(
            audio, language="en", task="transcribe", beam_size=self.beam_size if final else 1,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False, temperature=0.0, without_timestamps=True,
            no_speech_threshold=0.6, log_prob_threshold=-1.0,
        )
        parts = []
        for seg in segments:                      # `segments` is lazy: decoding happens while iterating
            if seg.no_speech_prob > 0.8 and seg.avg_logprob < -1.0:
                continue                          # almost certainly not speech
            parts.append(seg.text)
        return clean_text(" ".join(parts))


# --------------------------------------------------------------------------------------------------------------------------
# WebSocket service
# --------------------------------------------------------------------------------------------------------------------------
class Service:
    def __init__(self, transcriber: Callable[[np.ndarray, bool], str], model_name: str, device: str,
                 allowed_origins=DEFAULT_ORIGINS, partial_interval: float = 1.0, detector_options: Optional[dict] = None):
        self.transcribe = transcriber
        self.model_name = model_name
        self.device = device
        self.allowed_origins = set(allowed_origins)
        self.partial_interval = partial_interval
        self.detector_options = detector_options or {}
        self.executor = ThreadPoolExecutor(max_workers=1)   # one model, one job at a time
        self.connections = 0

    @staticmethod
    def _origin(ws) -> Optional[str]:
        request = getattr(ws, "request", None)
        headers = getattr(request, "headers", None) if request is not None else getattr(ws, "request_headers", None)
        return headers.get("Origin") if headers is not None else None

    async def handler(self, ws) -> None:
        origin = self._origin(ws)
        if origin is not None and origin not in self.allowed_origins:
            log.warning("rejected a connection from origin %s", origin)
            await ws.close(code=1008, reason="origin not allowed")
            return
        if self.connections >= MAX_CONNECTIONS:
            await ws.close(code=1013, reason="too many connections")
            return
        self.connections += 1
        try:
            await self._session(ws)
        except Exception as exc:  # a closed connection or a bad client must never take the service down
            if exc.__class__.__name__ not in ("ConnectionClosedOK", "ConnectionClosedError", "ConnectionClosed"):
                log.warning("session ended with %s", exc.__class__.__name__)
        finally:
            self.connections -= 1

    async def _send(self, ws, payload: dict) -> None:
        try:
            await ws.send(json.dumps(payload))
        except Exception:
            pass  # the client went away

    async def _session(self, ws) -> None:
        loop = asyncio.get_running_loop()
        detector: Optional[TurnDetector] = None
        listening = True
        epoch = 0            # changes whenever the page turns listening on/off: results of older epochs are dropped
        turn = 0
        partial_running = False
        last_partial_at = 0.0
        last_partial_len = 0
        last_partial_text = ""
        pending: set = set()

        def track(task: "asyncio.Task") -> None:
            pending.add(task)
            task.add_done_callback(pending.discard)

        async def run(audio: np.ndarray, final: bool) -> str:
            return await loop.run_in_executor(self.executor, self.transcribe, audio, final)

        async def do_partial(my_epoch: int, my_turn: int, audio: np.ndarray) -> None:
            nonlocal partial_running, last_partial_text
            try:
                text = await run(audio, False)
                if text and text != last_partial_text and my_epoch == epoch and my_turn == turn and detector is not None and detector.in_speech:
                    last_partial_text = text
                    await self._send(ws, {"type": "partial", "text": text})
            except Exception:
                pass  # partial text is a nicety: a failed partial must not disturb the turn
            finally:
                partial_running = False

        async def do_final(my_epoch: int, audio: np.ndarray) -> None:
            t0 = time.monotonic()
            try:
                text = await run(audio, True)
            except Exception as exc:
                log.warning("transcription failed (%s)", exc.__class__.__name__)
                if my_epoch == epoch:
                    await self._send(ws, {"type": "transcription_failed"})
                return
            log.info("turn transcribed: %.1fs of audio in %.2fs (%d characters)", audio.size / SAMPLE_RATE, time.monotonic() - t0, len(text))
            if text and my_epoch == epoch:
                await self._send(ws, {"type": "final", "text": text})

        try:
            async for message in ws:
                if isinstance(message, (bytes, bytearray)):
                    if detector is None or not listening:
                        continue
                    usable = len(message) - (len(message) % 2)
                    if usable <= 0:
                        continue
                    samples = np.frombuffer(bytes(message[:usable]), dtype="<i2").astype(np.float32) / 32768.0
                    for ev in detector.feed(samples):
                        if ev.kind == "speech_started":
                            turn += 1
                            last_partial_len = 0
                            last_partial_text = ""
                            await self._send(ws, {"type": "speech_started"})
                        elif ev.kind == "endpoint":
                            await self._send(ws, {"type": "speech_stopped"})
                            track(asyncio.ensure_future(do_final(epoch, ev.audio)))
                        # "discard": a noise burst that was too short to be speech - nothing is sent
                    now = time.monotonic()
                    if (detector.in_speech and not partial_running and detector.speech_ms >= 600
                            and now - last_partial_at >= self.partial_interval and detector.speech_ms - last_partial_len >= 400):
                        partial_running = True
                        last_partial_at = now
                        last_partial_len = detector.speech_ms
                        track(asyncio.ensure_future(do_partial(epoch, turn, detector.snapshot())))
                    continue

                try:
                    msg = json.loads(message)
                except (TypeError, ValueError):
                    continue
                kind = msg.get("type") if isinstance(msg, dict) else None
                if kind == "start" and detector is None:
                    if msg.get("sampleRate") != SAMPLE_RATE:
                        await self._send(ws, {"type": "error", "code": "bad_sample_rate"})
                        await ws.close(code=1008, reason="sampleRate must be 16000")
                        return
                    if str(msg.get("language", "en")).lower() != "en":
                        await self._send(ws, {"type": "error", "code": "english_only"})
                        await ws.close(code=1008, reason="English only")
                        return
                    options = dict(self.detector_options)
                    try:
                        options["silence_ms"] = min(4000, max(500, int(msg.get("silenceMs") or 1400)))
                    except (TypeError, ValueError):
                        options["silence_ms"] = 1400
                    detector = TurnDetector(**options)
                    await self._send(ws, {"type": "ready", "model": self.model_name, "device": self.device, "sampleRate": SAMPLE_RATE})
                elif kind == "listening" and detector is not None:
                    listening = bool(msg.get("on"))
                    epoch += 1
                    turn += 1
                    detector.reset()           # a new student turn always starts from a clean slate
                    partial_running = False
        finally:
            for task in list(pending):
                task.cancel()


def build_arg_parser() -> argparse.ArgumentParser:
    env = os.environ.get
    p = argparse.ArgumentParser(description="LearnIQ local speech-to-text service (development only, English only, 127.0.0.1 only).")
    p.add_argument("--model", default=env("LOCAL_STT_MODEL", "base.en"), help="faster-whisper model (default base.en; try small.en for better accuracy)")
    p.add_argument("--device", default=env("LOCAL_STT_DEVICE", "cpu"), choices=["cpu", "cuda", "auto"], help="cpu (default, works everywhere) or cuda (NVIDIA GPU)")
    p.add_argument("--compute-type", default=env("LOCAL_STT_COMPUTE_TYPE", ""), help="default: int8 on cpu, int8_float16 on cuda")
    p.add_argument("--port", type=int, default=int(env("LOCAL_STT_PORT", "8765")))
    p.add_argument("--beam-size", type=int, default=int(env("LOCAL_STT_BEAM", "3")))
    p.add_argument("--allowed-origin", action="append", default=None, help="extra browser origin allowed to connect (repeatable); env LOCAL_STT_ALLOWED_ORIGINS, comma separated")
    p.add_argument("--offline", action="store_true", default=env("LOCAL_STT_OFFLINE", "") in ("1", "true", "yes"), help="never download anything (the model must already be cached)")
    p.add_argument("--download-only", action="store_true", help="download/cache the model, then exit")
    p.add_argument("--log-level", default=env("LOCAL_STT_LOG_LEVEL", "INFO"))
    return p


async def serve(service: Service, port: int):
    import websockets
    return await websockets.serve(service.handler, HOST, port, max_size=2 ** 20, ping_interval=20, ping_timeout=20)


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(message)s")
    compute = args.compute_type or ("int8_float16" if args.device == "cuda" else "int8")
    log.info("loading model %s (device=%s, compute=%s%s) - the first run downloads it once", args.model, args.device, compute, ", offline" if args.offline else "")
    try:
        transcriber = FasterWhisperTranscriber(args.model, args.device, compute, args.offline, args.beam_size)
    except Exception as exc:
        log.error("could not load the model: %s: %s", exc.__class__.__name__, exc)
        log.error("on a CUDA error retry with --device cpu; with --offline the model must already be downloaded")
        return 2
    if args.download_only:
        log.info("model is ready on disk; nothing else to do")
        return 0
    origins = list(DEFAULT_ORIGINS) + (args.allowed_origin or []) + [o.strip() for o in env_list(os.environ.get("LOCAL_STT_ALLOWED_ORIGINS"))]
    service = Service(transcriber, args.model, args.device, origins)

    async def run() -> None:
        server = await serve(service, args.port)
        log.info("listening on ws://%s:%d  (this computer only; English only; nothing is stored)", HOST, args.port)
        await asyncio.Future()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
    return 0


def env_list(value: Optional[str]) -> List[str]:
    return [v for v in (value or "").split(",") if v.strip()]


if __name__ == "__main__":
    sys.exit(main())
