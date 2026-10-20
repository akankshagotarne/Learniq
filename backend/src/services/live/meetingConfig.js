/**
 * Meeting configuration for live classes: the participant-visibility MODE plus the publishing / chat / admission permissions.
 * Pure functions only (no I/O) so every rule is unit-testable. The server is the single authority: the client only displays what these
 * functions allow, and every privileged socket event re-checks them.
 *
 * Media architecture note: live classes use a browser WebRTC mesh signalled through Socket.IO. "Enforcement" therefore happens where the
 * server has control: (1) the signalling layer refuses offers / answers / ICE between peers that may not receive each other
 * (planPeers), (2) per-peer send/receive instructions, (3) server-validated camera / mic / screen state, (4) per-viewer filtered rosters.
 */
const audienceRules = require('./audience');
const MODES = ['everyone', 'host_only', 'host_and_selected', 'presentation', 'spotlight'];
const LAYOUTS = ['speaker', 'gallery'];
const PUBLISH = ['everyone', 'host_and_selected', 'host_only'];
const CHAT = ['everyone', 'host_only', 'off'];
const SCREEN = ['host_only', 'host_and_presenters'];
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_LIST = 60;

const MODE_INFO = {
  everyone: { label: 'Everyone can see everyone', hint: 'Everyone sees every participant whose camera is on. Best for small discussion classes.' },
  host_only: { label: 'Students see the host only', hint: 'Teacher-led lesson. Students see the teacher (or the shared screen) but not other students\' cameras. The teacher can still see and hear students.' },
  host_and_selected: { label: 'Host and selected students', hint: 'Everyone sees the teacher and the students the teacher selects. Other students\' cameras stay private to the teacher.' },
  presentation: { label: 'Presentation focus', hint: 'The shared screen gets the whole stage; the teacher\'s camera stays small.' },
  spotlight: { label: 'Host-controlled spotlight', hint: 'The teacher spotlights one participant, who is shown to everyone on the main stage.' },
};

const DEFAULTS = Object.freeze({
  mode: 'everyone',
  layout: 'speaker',
  videoPublish: 'everyone',
  audioPublish: 'everyone',
  screenShare: 'host_only',
  studentSelfUnmute: true,
  requireApproval: true,
  chatMode: 'everyone',
  hostCanSelectStudents: true,
  studentsSeeEachOther: true,
  selectedUserIds: [],
  spotlightUserId: null,
  presenterUserIds: [],
  locked: false,
  configVersion: 0,
});

const ids = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter((x) => OBJECT_ID.test(x)))].slice(0, MAX_LIST) : null);

/**
 * Merge `patch` over `base` and validate. Returns { config, errors[] }. Unknown keys are dropped; the version is NOT touched here.
 * Anything invalid is rejected with a message (never silently coerced to a broader permission).
 */
const sanitize = (patch = {}, base = DEFAULTS) => {
  const errors = [];
  const out = { ...DEFAULTS, ...(base || {}) };
  const src = patch && typeof patch === 'object' ? patch : {};
  const pickEnum = (key, list, label) => {
    if (src[key] === undefined) return;
    if (!list.includes(src[key])) errors.push(`${label} is not valid.`); else out[key] = src[key];
  };
  const pickBool = (key, label) => {
    if (src[key] === undefined) return;
    if (typeof src[key] !== 'boolean') errors.push(`${label} must be on or off.`); else out[key] = src[key];
  };
  pickEnum('mode', MODES, 'Visibility mode');
  pickEnum('layout', LAYOUTS, 'Layout');
  pickEnum('videoPublish', PUBLISH, 'Who may turn on video');
  pickEnum('audioPublish', PUBLISH, 'Who may speak');
  pickEnum('screenShare', SCREEN, 'Who may share the screen');
  pickEnum('chatMode', CHAT, 'Chat setting');
  pickBool('studentSelfUnmute', 'Student self-unmute');
  pickBool('requireApproval', 'Host approval');
  pickBool('hostCanSelectStudents', 'Select students');
  pickBool('studentsSeeEachOther', 'Students see each other');
  pickBool('locked', 'Admission lock');
  for (const key of ['selectedUserIds', 'presenterUserIds']) {
    if (src[key] === undefined) continue;
    const list = ids(src[key]);
    if (list === null) errors.push('The student list is not valid.'); else out[key] = list;
  }
  if (src.spotlightUserId !== undefined) {
    if (src.spotlightUserId === null || src.spotlightUserId === '') out.spotlightUserId = null;
    else if (OBJECT_ID.test(String(src.spotlightUserId))) out.spotlightUserId = String(src.spotlightUserId);
    else errors.push('The spotlight participant is not valid.');
  }
  // who may JOIN (separate from what participants see): validated structurally here, against the database where it is saved
  if (src.audience !== undefined) {
    const r = audienceRules.sanitizeAudience(src.audience, audienceRules.normalizeAudience(out.audience) || audienceRules.DEFAULT_AUDIENCE);
    if (r.errors.length) errors.push(r.errors[0]); else out.audience = r.audience;
  } else if (out.audience !== undefined) {
    const a = audienceRules.normalizeAudience(out.audience);
    if (a) out.audience = a; else delete out.audience;           // a malformed stored value behaves like an older class (never locks everyone out)
  }
  // visibility between students is DEFINED by the mode where the mode says so
  if (out.mode === 'everyone') out.studentsSeeEachOther = true;
  if (out.mode === 'host_only') out.studentsSeeEachOther = false;
  if (out.mode === 'presentation') out.layout = 'speaker';
  out.configVersion = Number.isInteger(out.configVersion) ? out.configVersion : 0;
  return { config: out, errors };
};

const normalize = (stored) => sanitize({}, stored && typeof stored === 'object' ? { ...DEFAULTS, ...stored } : DEFAULTS).config;

// ── per-participant rules ─────────────────────────────────────────────────────────────────────────────
const isSelected = (cfg, p) => cfg.selectedUserIds.includes(String(p.userId));
const isPresenter = (cfg, p) => cfg.presenterUserIds.includes(String(p.userId));
const isSpotlit = (cfg, p) => cfg.mode === 'spotlight' && cfg.spotlightUserId && String(cfg.spotlightUserId) === String(p.userId);

const canPublishVideo = (cfg, p) => {
  if (p.isHost) return true;
  if (p.blocks && p.blocks.camera) return false;
  if (p.grants && p.grants.camera) return true;
  if (cfg.videoPublish === 'everyone') return true;
  if (cfg.videoPublish === 'host_and_selected') return isSelected(cfg, p);
  return false;
};
const canPublishAudio = (cfg, p) => {
  if (p.isHost) return true;
  if (p.blocks && p.blocks.mic) return false;
  if (p.grants && p.grants.mic) return true;
  if (cfg.audioPublish === 'everyone') return cfg.studentSelfUnmute;
  if (cfg.audioPublish === 'host_and_selected') return isSelected(cfg, p);
  return false;
};
const canShareScreen = (cfg, p) => p.isHost || (cfg.screenShare === 'host_and_presenters' && isPresenter(cfg, p));
const canChat = (cfg, p) => cfg.chatMode === 'everyone' || (cfg.chatMode === 'host_only' && p.isHost);

/** May `viewer` receive `publisher`'s audio / video? (the one rule the signalling layer enforces) */
const canReceive = (cfg, viewer, publisher) => {
  if (viewer.socketId === publisher.socketId) return false;
  if (publisher.isHost || viewer.isHost) return true;
  if (publisher.isScreenSharing) return true;               // a shared screen is for the whole class
  if (isSpotlit(cfg, publisher)) return true;
  switch (cfg.mode) {
    case 'everyone': return true;
    case 'host_only': return false;
    case 'host_and_selected': return isSelected(cfg, publisher);
    default: return cfg.studentsSeeEachOther;                // presentation / spotlight
  }
};

/**
 * The full peer plan for a room. For every participant: the list of peers it should hold a connection with and, per peer, whether it
 * may SEND to it and whether it should RECEIVE from it. A pair with neither direction allowed has no connection at all.
 */
const planPeers = (cfg, participants) => {
  const list = Object.values(participants);
  const plan = {};
  list.forEach((a) => { plan[a.socketId] = []; });
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]; const b = list[j];
      const aToB = canReceive(cfg, b, a);   // b receives a
      const bToA = canReceive(cfg, a, b);
      if (!aToB && !bToA) continue;
      plan[a.socketId].push({ socketId: b.socketId, userId: String(b.userId), send: aToB, receive: bToA });
      plan[b.socketId].push({ socketId: a.socketId, userId: String(a.userId), send: bToA, receive: aToB });
    }
  }
  return plan;
};

/** Do these two participants hold a connection under the current plan? (signalling gate) */
const mayConnect = (cfg, a, b) => canReceive(cfg, a, b) || canReceive(cfg, b, a);

/** Stage description sent to every client (clients render from this - they never decide who is featured). */
const stageFor = (cfg, participants) => {
  const list = Object.values(participants);
  const host = list.find((p) => p.isHost && !p.isAdminConsole) || null;
  const sharer = list.find((p) => p.isScreenSharing && (p.isHost || canShareScreen(cfg, p))) || null;
  const spot = cfg.mode === 'spotlight' && cfg.spotlightUserId ? list.find((p) => String(p.userId) === String(cfg.spotlightUserId)) || null : null;
  const featured = cfg.mode === 'host_and_selected' ? list.filter((p) => !p.isHost && isSelected(cfg, p)).map((p) => p.socketId) : [];
  return {
    mode: cfg.mode,
    layout: cfg.mode === 'presentation' ? 'speaker' : cfg.layout,
    hostSocketId: host ? host.socketId : null,
    screenShareSocketId: sharer ? sharer.socketId : null,
    spotlightSocketId: spot ? spot.socketId : null,
    featuredSocketIds: featured,
  };
};

/** Public config (what clients may see). */
const publicConfig = (cfg) => ({ ...cfg, info: MODE_INFO[cfg.mode], audienceLegacy: audienceRules.isLegacy(cfg), audienceSummary: audienceRules.summarize(cfg) });

module.exports = {
  MODES, LAYOUTS, PUBLISH, CHAT, SCREEN, MODE_INFO, DEFAULTS, sanitize, normalize,
  canPublishVideo, canPublishAudio, canShareScreen, canChat, canReceive, mayConnect, planPeers, stageFor, publicConfig,
  isSelected, isPresenter, isSpotlit,
};
