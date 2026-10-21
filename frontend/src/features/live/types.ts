/** Wire types shared by the live-class client code. They mirror services/live/* on the server (the server is the authority). */
import type { Audience } from './audience';

export type VisibilityMode = 'everyone' | 'host_only' | 'host_and_selected' | 'presentation' | 'spotlight';
export type PublishRule = 'everyone' | 'host_and_selected' | 'host_only';

export interface MeetingConfig {
  mode: VisibilityMode;
  layout: 'speaker' | 'gallery';
  videoPublish: PublishRule;
  audioPublish: PublishRule;
  screenShare: 'host_only' | 'host_and_presenters';
  studentSelfUnmute: boolean;
  requireApproval: boolean;
  chatMode: 'everyone' | 'host_only' | 'off';
  hostCanSelectStudents: boolean;
  studentsSeeEachOther: boolean;
  selectedUserIds?: string[];
  presenterUserIds?: string[];
  spotlightUserId: string | null;
  locked: boolean;
  configVersion: number;
  info?: { label: string; hint: string };
  /** who may join (owner / host only gets the ids; students only the kind). Missing = an older class with its original open behaviour. */
  audience?: Audience;
  audienceLegacy?: boolean;
  audienceSummary?: { students: string; teachers: string; access: string };
}

export const DEFAULT_CONFIG: MeetingConfig = {
  mode: 'everyone', layout: 'speaker', videoPublish: 'everyone', audioPublish: 'everyone', screenShare: 'host_only', studentSelfUnmute: true,
  requireApproval: true, chatMode: 'everyone', hostCanSelectStudents: true, studentsSeeEachOther: true, selectedUserIds: [], presenterUserIds: [],
  spotlightUserId: null, locked: false, configVersion: 0,
};

export interface StageInfo {
  mode: VisibilityMode;
  layout: 'speaker' | 'gallery';
  hostSocketId: string | null;
  screenShareSocketId: string | null;
  spotlightSocketId: string | null;
  featuredSocketIds: string[];
}

export interface RoomParticipant {
  socketId: string;
  userId: string;
  name: string;
  role: string;
  isHost: boolean;
  isTeacher: boolean;
  /** an administrator who joined the meeting as a moderator (set by the server only) */
  isAdmin?: boolean;
  isCameraOn: boolean;
  isMicOn: boolean;
  isScreenSharing: boolean;
  isPortrait?: boolean;
  standard?: number | null;
  // host / admin only
  canVideo?: boolean; canAudio?: boolean; canScreen?: boolean; canChat?: boolean;
  micBlocked?: boolean; cameraBlocked?: boolean; selected?: boolean; presenter?: boolean; spotlit?: boolean;
}

export interface Permissions {
  canVideo: boolean; canAudio: boolean; canScreen: boolean; canChat: boolean;
  micBlocked: boolean; cameraBlocked: boolean; selected: boolean; presenter: boolean; spotlit: boolean;
}
export const NO_PERMISSIONS: Permissions = { canVideo: true, canAudio: true, canScreen: false, canChat: true, micBlocked: false, cameraBlocked: false, selected: false, presenter: false, spotlit: false };

export interface PeerPlanEntry { socketId: string; userId: string; send: boolean; receive: boolean }

export interface McqQuestion {
  mcqId: string; question: string; options: string[];
  openedAt: number; closesAt: number; durationMs: number; remainingMs: number; serverNow: number;
}
/** What the server says about the current question right now (joined / mcq-state / get-mcq-state). */
export type McqServerState =
  | { state: 'idle' }
  | { state: 'open'; mcq: McqQuestion; submitted?: boolean; selectedOption?: number; answerTimeMs?: number; correctIndex?: number; progress?: McqProgress }
  | { state: 'ranking'; ranking: RankingCard }
  | { state: 'closing'; mcqId: string };

export interface McqProgress { mcqId: string; eligible: number; submitted: number; correct?: number; remainingMs?: number }

export interface RankingEntry { rank: number; userId: string; name: string; standard: string; answerTimeMs: number; answerTimeLabel: string }
export interface RankingCard {
  mcqId: string; title: string; ranking: RankingEntry[]; noQualifying: boolean; displayMs: number; shownAt: number; endsAt: number; serverNow: number; remainingMs: number;
}

export interface HostResults {
  mcqId: string; question: string; options: string[]; correctIndex: number; reason: string;
  totals: { eligible: number; submitted: number; correct: number };
  results: { position: number; userId: string; name: string; standard: string; selectedOption: number; isCorrect: boolean; answerTimeMs: number }[];
  notAnswered: { userId: string; name: string; standard: string }[];
  ranking: RankingEntry[];
}

export interface WaitingEntry { socketId: string; userId: string; name: string }

export interface ChatItem { _id?: string; senderName: string; senderRole: string; message: string; createdAt: string }

export interface ScoreEntry { userId: string; name: string; correct: number; wrong: number; rank: number; totalResponseTimeSec?: number }

export interface JoinedPayload {
  self: { socketId: string; userId: string; name: string; isHost: boolean; isAdmin?: boolean };
  session: { code: string; title: string };
  participants: RoomParticipant[];
  counts: { students: number; waiting: number; hostPresent: boolean; locked: boolean };
  config: MeetingConfig;
  stage: StageInfo;
  permissions: Permissions;
  peers: PeerPlanEntry[];
  mcq: McqServerState;
  scoreboard: ScoreEntry[];
  waitingRoom?: WaitingEntry[];
  hostPresent: boolean;
  serverNow: number;
}

export interface AdminSnapshot {
  sessionCode: string; title: string; config: MeetingConfig; stage: StageInfo;
  counts: { students: number; waiting: number; hostPresent: boolean; locked: boolean };
  participants: RoomParticipant[]; waitingRoom: WaitingEntry[]; mcq: McqServerState; serverNow: number; consoles: number;
}

export interface Ack { ok: boolean; code?: string; message?: string; [k: string]: any }

export const VISIBILITY_MODES: { value: VisibilityMode; label: string; hint: string }[] = [
  { value: 'everyone', label: 'Everyone can see everyone', hint: 'Every participant whose camera is on is visible to the whole class. Best for small discussion classes.' },
  { value: 'host_only', label: 'Students see the host only', hint: "Teacher-led lesson. Students see the teacher (or the shared screen) but not other students' cameras. The teacher still sees every student." },
  { value: 'host_and_selected', label: 'Host and selected students', hint: "Everyone sees the teacher and the students the teacher selects. Other students' cameras stay private to the teacher." },
  { value: 'presentation', label: 'Presentation focus', hint: "The shared screen gets the whole stage and the teacher's camera stays small." },
  { value: 'spotlight', label: 'Host-controlled spotlight', hint: 'The teacher spotlights one person, who is shown to everyone on the main stage.' },
];
