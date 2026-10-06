"""
Tests for server.py -- no model, no network, no microphone: the transcriber is replaced by a tiny fake and the "speech" is a
synthetic tone. Run from this folder:

    python -m unittest -v test_server
"""
import asyncio
import builtins
import json
import math
import time
import unittest

import numpy as np

import server
from server import FRAME, HOST, SAMPLE_RATE, Service, TurnDetector, clean_text


def tone(seconds: float, amp: float = 0.2, freq: float = 440.0) -> np.ndarray:
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return (amp * np.sin(2 * math.pi * freq * t)).astype(np.float32)


def silence(seconds: float, level: float = 0.0015) -> np.ndarray:
    rng = np.random.default_rng(7)
    return (level * rng.standard_normal(int(SAMPLE_RATE * seconds))).astype(np.float32)


def pcm(samples: np.ndarray) -> bytes:
    return (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()


def kinds(events):
    return [e.kind for e in events]


class TurnDetectorTests(unittest.TestCase):
    def feed_all(self, det, samples, chunk=FRAME * 2):
        out = []
        for i in range(0, samples.size, chunk):
            out += det.feed(samples[i:i + chunk])
        return out

    def test_silence_and_background_noise_trigger_nothing(self):
        det = TurnDetector()
        self.assertEqual(self.feed_all(det, silence(5.0)), [])
        self.assertFalse(det.in_speech)

    def test_a_spoken_turn_starts_and_ends_once_with_the_audio(self):
        det = TurnDetector(silence_ms=1000)
        events = self.feed_all(det, np.concatenate([silence(0.5), tone(1.2), silence(1.5)]))
        self.assertEqual(kinds(events), ["speech_started", "endpoint"])
        audio = events[1].audio
        seconds = audio.size / SAMPLE_RATE
        self.assertGreater(seconds, 1.2)           # the whole word plus a little pre-roll / trailing pause
        self.assertLess(seconds, 2.3)              # but not the whole pause
        self.assertFalse(det.in_speech)

    def test_a_click_is_not_speech(self):
        det = TurnDetector()
        self.assertEqual(self.feed_all(det, np.concatenate([silence(0.5), tone(0.05), silence(2.0)])), [])

    def test_two_turns_in_a_row(self):
        det = TurnDetector(silence_ms=800)
        audio = np.concatenate([tone(0.8), silence(1.2), tone(0.9), silence(1.2)])
        self.assertEqual(kinds(self.feed_all(det, audio)), ["speech_started", "endpoint", "speech_started", "endpoint"])

    def test_very_long_turns_are_cut_at_the_limit(self):
        det = TurnDetector(max_turn_ms=3000)
        events = self.feed_all(det, tone(5.0))
        self.assertIn("endpoint", kinds(events))
        self.assertLessEqual(next(e for e in events if e.kind == "endpoint").audio.size / SAMPLE_RATE, 3.4)

    def test_reset_forgets_a_turn_in_progress(self):
        det = TurnDetector()
        self.feed_all(det, tone(1.0))
        self.assertTrue(det.in_speech)
        det.reset()
        self.assertFalse(det.in_speech)
        self.assertEqual(det.speech_ms, 0)

    def test_odd_chunk_sizes_do_not_lose_samples(self):
        det = TurnDetector(silence_ms=600)
        audio = np.concatenate([tone(1.0), silence(1.0)])
        events = []
        for i in range(0, audio.size, 123):
            events += det.feed(audio[i:i + 123])
        self.assertEqual(kinds(events), ["speech_started", "endpoint"])

    def test_clean_text(self):
        self.assertEqual(clean_text("  Plants   need sunlight. "), "Plants need sunlight.")
        for junk in ["", "[BLANK_AUDIO]", "(coughing)", "*sigh*", "...", "♪ ♪", None]:
            self.assertEqual(clean_text(junk), "", junk)


class FasterWhisperContractTests(unittest.TestCase):
    """The real model cannot be run in the tests (it needs the downloaded weights); at least check the calls match the installed API."""

    def test_arguments_we_pass_exist_in_the_installed_faster_whisper(self):
        try:
            import inspect
            from faster_whisper import WhisperModel
            from faster_whisper.vad import VadOptions
        except ImportError:
            self.skipTest("faster-whisper is not installed")
        transcribe = set(inspect.signature(WhisperModel.transcribe).parameters)
        init = set(inspect.signature(WhisperModel.__init__).parameters)
        self.assertLessEqual({"language", "task", "beam_size", "vad_filter", "vad_parameters", "condition_on_previous_text", "temperature",
                              "without_timestamps", "no_speech_threshold", "log_prob_threshold"}, transcribe)
        self.assertLessEqual({"device", "compute_type", "local_files_only"}, init)
        self.assertIn("min_silence_duration_ms", {f for f in getattr(VadOptions, "__dataclass_fields__", {})} or {"min_silence_duration_ms"})

    def test_an_unavailable_model_is_reported_not_crashed(self):
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            self.skipTest("faster-whisper is not installed")
        self.assertEqual(server.main(["--model", "definitely-not-a-real-model-xyz", "--offline"]), 2)


class FakeTranscriber:
    def __init__(self, delay=0.0, fail=False):
        self.calls = []
        self.delay = delay
        self.fail = fail

    def __call__(self, audio, final):
        self.calls.append((final, audio.size))
        if self.delay:
            time.sleep(self.delay)
        if self.fail and final:
            raise RuntimeError("model exploded")
        return "plants need sunlight" if final else "plants need"


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import websockets
        self.websockets = websockets
        self.transcriber = FakeTranscriber()
        self.service = Service(self.transcriber, "base.en", "cpu", partial_interval=0.0)
        self.server = await server.serve(self.service, 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()

    async def connect(self, origin=None):
        uri = f"ws://{HOST}:{self.port}"
        if origin is None:
            return await self.websockets.connect(uri)
        for name in ("additional_headers", "extra_headers"):       # the keyword differs between websockets versions
            try:
                return await self.websockets.connect(uri, **{name: {"Origin": origin}})
            except TypeError:
                continue
        raise AssertionError("no way to set the Origin header")

    async def start(self, ws, **over):
        await ws.send(json.dumps({"type": "start", "sampleRate": 16000, "language": "en", "silenceMs": 800, **over}))
        return json.loads(await asyncio.wait_for(ws.recv(), 5))

    async def stream(self, ws, samples, chunk_seconds=0.04):
        step = int(SAMPLE_RATE * chunk_seconds)
        for i in range(0, samples.size, step):
            await ws.send(pcm(samples[i:i + step]))
            await asyncio.sleep(0)

    async def collect(self, ws, until, timeout=5.0):
        out = []
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), max(0.05, end - time.monotonic())))
            except asyncio.TimeoutError:
                break
            out.append(msg)
            if msg.get("type") in until:
                break
        return out

    # -- tests ---------------------------------------------------------------------------------------------------------
    async def test_binds_to_loopback_only(self):
        host = self.server.sockets[0].getsockname()[0]
        self.assertEqual(host, "127.0.0.1")
        self.assertEqual(HOST, "127.0.0.1")
        self.assertFalse(any(a.dest == "host" for a in server.build_arg_parser()._actions), "there must be no --host option")

    async def test_full_turn_gives_started_partial_stopped_final_in_order(self):
        async with await self.connect("http://localhost:5173") as ws:
            ready = await self.start(ws)
            self.assertEqual(ready["type"], "ready")
            self.assertEqual((ready["model"], ready["device"], ready["sampleRate"]), ("base.en", "cpu", 16000))
            await self.stream(ws, np.concatenate([silence(0.3), tone(1.8), silence(1.4)]))
            msgs = await self.collect(ws, until={"final"})
        types = [m["type"] for m in msgs]
        self.assertEqual(types[0], "speech_started")
        self.assertEqual(types[-1], "final")
        self.assertEqual(msgs[-1]["text"], "plants need sunlight")
        self.assertIn("speech_stopped", types)
        self.assertLess(types.index("speech_stopped"), types.index("final"))
        self.assertIn("partial", types, "live text while the student is still speaking")
        self.assertTrue(all(i < types.index("speech_stopped") for i, t in enumerate(types) if t == "partial"), "no partial after the turn ended")
        self.assertEqual(next(m for m in msgs if m["type"] == "partial")["text"], "plants need")
        self.assertTrue(any(final for final, _ in self.transcriber.calls))

    async def test_audio_while_not_listening_is_ignored(self):
        async with await self.connect() as ws:
            await self.start(ws)
            await ws.send(json.dumps({"type": "listening", "on": False}))
            await self.stream(ws, np.concatenate([tone(1.5), silence(1.5)]))
            msgs = await self.collect(ws, until={"final"}, timeout=0.6)
        self.assertEqual(msgs, [])
        self.assertEqual(self.transcriber.calls, [])

    async def test_turning_listening_off_drops_a_result_that_is_still_being_computed(self):
        self.transcriber.delay = 0.4
        async with await self.connect() as ws:
            await self.start(ws)
            await self.stream(ws, np.concatenate([tone(1.2), silence(1.2)]))
            first = await self.collect(ws, until={"speech_stopped"})
            self.assertEqual(first[-1]["type"], "speech_stopped")
            await ws.send(json.dumps({"type": "listening", "on": False}))   # the page moved on before the transcript arrived
            late = await self.collect(ws, until={"final"}, timeout=1.2)
        self.assertEqual([m for m in late if m["type"] == "final"], [])

    async def test_a_new_listening_turn_starts_clean(self):
        async with await self.connect() as ws:
            await self.start(ws)
            await self.stream(ws, tone(1.0))                                # half a turn...
            await ws.send(json.dumps({"type": "listening", "on": True}))    # ...then the page restarts listening
            await self.stream(ws, silence(2.0))
            msgs = await self.collect(ws, until={"final"}, timeout=0.6)
        self.assertEqual([m for m in msgs if m["type"] == "final"], [])

    async def test_noise_burst_produces_no_events(self):
        async with await self.connect() as ws:
            await self.start(ws)
            await self.stream(ws, np.concatenate([silence(0.5), tone(0.04), silence(2.0)]))
            msgs = await self.collect(ws, until={"final"}, timeout=0.6)
        self.assertEqual(msgs, [])

    async def test_a_failing_model_reports_transcription_failed(self):
        self.transcriber.fail = True
        async with await self.connect() as ws:
            await self.start(ws)
            await self.stream(ws, np.concatenate([tone(1.2), silence(1.2)]))
            msgs = await self.collect(ws, until={"transcription_failed", "final"})
        self.assertEqual(msgs[-1]["type"], "transcription_failed")

    async def test_english_only_and_16khz_only(self):
        async with await self.connect() as ws:
            reply = await self.start(ws, language="hi")
            self.assertEqual(reply, {"type": "error", "code": "english_only"})
        async with await self.connect() as ws:
            reply = await self.start(ws, sampleRate=48000)
            self.assertEqual(reply, {"type": "error", "code": "bad_sample_rate"})

    async def test_other_websites_are_refused_but_the_dev_server_and_tools_are_allowed(self):
        ws = await self.connect("https://evil.example")
        with self.assertRaises(self.websockets.exceptions.ConnectionClosed) as ctx:
            await ws.send(json.dumps({"type": "start", "sampleRate": 16000, "language": "en"}))
            await asyncio.wait_for(ws.recv(), 3)
        self.assertEqual(ctx.exception.rcvd.code, 1008)
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173", None):
            async with await self.connect(origin) as ok:
                self.assertEqual((await self.start(ok))["type"], "ready", origin)

    async def test_odd_sized_and_garbage_frames_do_not_crash_the_service(self):
        async with await self.connect() as ws:
            await self.start(ws)
            await ws.send(b"\x01")                 # odd, too short
            await ws.send(b"\x01\x02\x03")         # odd length
            await ws.send("not json")
            await ws.send(json.dumps([1, 2, 3]))
            await self.stream(ws, np.concatenate([tone(1.2), silence(1.2)]))
            msgs = await self.collect(ws, until={"final"})
        self.assertEqual(msgs[-1]["type"], "final")

    async def test_nothing_is_written_to_disk_during_a_session(self):
        real_open = builtins.open
        writes = []

        def guarded(file, mode="r", *a, **k):
            if any(c in str(mode) for c in "wax+"):
                writes.append((file, mode))
            return real_open(file, mode, *a, **k)

        builtins.open = guarded
        try:
            async with await self.connect() as ws:
                await self.start(ws)
                await self.stream(ws, np.concatenate([tone(1.5), silence(1.4)]))
                await self.collect(ws, until={"final"})
        finally:
            builtins.open = real_open
        self.assertEqual(writes, [], "audio and transcripts must never be written to disk")

    async def test_transcripts_are_never_logged(self):
        with self.assertLogs("local-stt", level="INFO") as captured:
            async with await self.connect() as ws:
                await self.start(ws)
                await self.stream(ws, np.concatenate([tone(1.5), silence(1.4)]))
                await self.collect(ws, until={"final"})
                await asyncio.sleep(0.1)
        text = "\n".join(captured.output)
        self.assertNotIn("plants", text)
        self.assertIn("characters", text)            # only the length is logged

    async def test_too_many_connections_are_refused(self):
        sockets = [await self.connect() for _ in range(server.MAX_CONNECTIONS)]
        try:
            for ws in sockets:
                self.assertEqual((await self.start(ws))["type"], "ready")
            extra = await self.connect()
            with self.assertRaises(self.websockets.exceptions.ConnectionClosed) as ctx:
                await extra.send(json.dumps({"type": "start", "sampleRate": 16000}))
                await asyncio.wait_for(extra.recv(), 3)
            self.assertEqual(ctx.exception.rcvd.code, 1013)
        finally:
            for ws in sockets:
                await ws.close()


if __name__ == "__main__":
    unittest.main()
