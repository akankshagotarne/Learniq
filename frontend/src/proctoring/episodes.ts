/**
 * Turns raw per-frame detector readings into CONFIRMED episodes. Pure logic (no DOM, no React) so it can be unit-tested
 * with controlled readings: `node --experimental-strip-types --test e2e/unit/episodes.test.ts`.
 *
 * Rules (per condition: no face / 2+ faces / phone):
 *   - a condition must hold for its persistence time AND on at least 2 readings before it is confirmed (one bad frame
 *     never creates a warning)
 *   - a confirmed episode produces ONE event; it stays open while the condition continues, so a long absence is still
 *     one warning
 *   - the episode only ends after the condition has been gone for `recoveryMs`; after that a new episode can start
 *   - a gap in readings (inference stalled, tab hidden, camera hiccup) cancels a pending confirmation instead of
 *     treating the missing data as "no face"
 */

export type EpisodeType = 'FACE_MISSING' | 'MULTIPLE_FACES' | 'MOBILE_PHONE_DETECTED';

/** One detector reading. null = this signal was not measured in this reading. */
export interface Observation {
  at: number;                 // ms, monotonic (performance.now())
  faceCount: number | null;
  phoneScore: number | null;  // highest "cell phone" score in the frame (0 when none)
}

export interface EpisodeConfig {
  faceAbsenceThresholdMs: number;
  multiFacePersistenceMs: number;
  phonePersistenceMs: number;
  phoneConfidence: number;
  recoveryMs: number;
  maxGapMs: number;           // readings further apart than this are not trusted to confirm anything
  faceMonitoring?: boolean;
  multiFaceMonitoring?: boolean;
  phoneDetection?: boolean;
}

export interface Episode {
  type: EpisodeType;
  startedAt: number;
  confirmedAt: number;
  durationMs: number;         // how long the condition had held when it was confirmed
  confidence?: number;        // phone: best score seen during the confirmation window
  faceCount?: number;         // multi-face: largest count seen
}

interface Tracker {
  type: EpisodeType;
  persistMs: number;
  toleranceMs: number;        // a pending condition survives a negative reading this short (detector flicker)
  phase: 'idle' | 'pending' | 'active';
  since: number;
  samples: number;
  falseSince: number | null;
  peak: number;
  lastAt: number | null;
}

const tracker = (type: EpisodeType, persistMs: number, toleranceMs: number): Tracker => ({
  type, persistMs, toleranceMs, phase: 'idle', since: 0, samples: 0, falseSince: null, peak: 0, lastAt: null,
});

const resetTracker = (t: Tracker) => { t.phase = 'idle'; t.samples = 0; t.falseSince = null; t.peak = 0; };

/** Advance one tracker with one reading; returns a confirmed episode or null. */
const step = (t: Tracker, at: number, condition: boolean, value: number, cfg: EpisodeConfig): Episode | null => {
  const gap = t.lastAt === null ? 0 : at - t.lastAt;
  t.lastAt = at;
  if (gap > cfg.maxGapMs && t.phase === 'pending') resetTracker(t); // stale data cannot confirm anything

  if (condition) {
    t.falseSince = null;
    if (t.phase === 'idle') { t.phase = 'pending'; t.since = at; t.samples = 1; t.peak = value; return null; }
    t.samples += 1;
    t.peak = Math.max(t.peak, value);
    if (t.phase === 'pending' && at - t.since >= t.persistMs && t.samples >= 2) {
      t.phase = 'active';
      const ep: Episode = { type: t.type, startedAt: t.since, confirmedAt: at, durationMs: at - t.since };
      if (t.type === 'MOBILE_PHONE_DETECTED') ep.confidence = Math.round(t.peak * 1000) / 1000;
      if (t.type === 'MULTIPLE_FACES') ep.faceCount = t.peak;
      return ep;
    }
    return null;
  }

  // condition not present in this reading
  if (t.phase === 'idle') return null;
  if (t.falseSince === null) t.falseSince = at;
  const goneFor = at - t.falseSince;
  if (t.phase === 'pending' && goneFor >= t.toleranceMs) resetTracker(t);
  else if (t.phase === 'active' && goneFor >= cfg.recoveryMs) resetTracker(t); // episode over: the next one counts again
  return null;
};

export interface EpisodeTracker {
  observe(o: Observation): Episode[];
  /** Is each condition currently inside a confirmed episode? (for status indicators) */
  active(): Record<EpisodeType, boolean>;
  reset(): void;
}

export const createEpisodeTracker = (cfg: EpisodeConfig): EpisodeTracker => {
  const face = tracker('FACE_MISSING', cfg.faceAbsenceThresholdMs, 0);       // any visible face cancels a pending absence
  const multi = tracker('MULTIPLE_FACES', cfg.multiFacePersistenceMs, 700);  // one frame of "1 face" does not cancel
  const phone = tracker('MOBILE_PHONE_DETECTED', cfg.phonePersistenceMs, 1200);
  return {
    observe(o) {
      const out: Episode[] = [];
      if (o.faceCount !== null) {
        if (cfg.faceMonitoring !== false) { const e = step(face, o.at, o.faceCount === 0, 0, cfg); if (e) out.push(e); }
        if (cfg.multiFaceMonitoring !== false) { const e = step(multi, o.at, o.faceCount >= 2, o.faceCount, cfg); if (e) out.push(e); }
      }
      if (o.phoneScore !== null && cfg.phoneDetection !== false) {
        const e = step(phone, o.at, o.phoneScore >= cfg.phoneConfidence, o.phoneScore, cfg);
        if (e) out.push(e);
      }
      return out;
    },
    active: () => ({ FACE_MISSING: face.phase === 'active', MULTIPLE_FACES: multi.phase === 'active', MOBILE_PHONE_DETECTED: phone.phase === 'active' }),
    reset() { [face, multi, phone].forEach((t) => { resetTracker(t); t.lastAt = null; }); },
  };
};

export type FaceCheckStatus = 'waiting' | 'no_face' | 'multiple' | 'steadying' | 'ok';

/**
 * Pre-exam face check: exactly one face, held steadily for `stableMs` (default 2 s). Brief detector misses during the
 * steadying period restart the clock rather than failing the check.
 */
export const createFaceCheck = (stableMs = 2000) => {
  let since: number | null = null;
  let status: FaceCheckStatus = 'waiting';
  return {
    observe(at: number, faceCount: number): FaceCheckStatus {
      if (faceCount === 1) {
        if (since === null) since = at;
        status = at - since >= stableMs ? 'ok' : 'steadying';
      } else {
        since = null;
        status = faceCount === 0 ? 'no_face' : 'multiple';
      }
      return status;
    },
    status: () => status,
    reset() { since = null; status = 'waiting'; },
  };
};
