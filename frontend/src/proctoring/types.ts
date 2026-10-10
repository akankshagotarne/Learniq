/** Mirrors backend/src/services/proctoring/policy.js and models/Proctoring.js - keep the names identical. */
export type SwitchAction = 'WARN' | 'WARN_AND_REQUIRE_FULLSCREEN' | 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH';
export type CameraFailureAction = 'BLOCK_UNTIL_RESTORED' | 'AUTO_SUBMIT_AFTER_GRACE';
export type ExamKind = 'exam' | 'olympiad';

export interface ProctoringPolicy {
  enabled: boolean;
  version?: number;
  cameraRequired: boolean;
  faceMonitoring: boolean;
  multiFaceMonitoring: boolean;
  phoneDetection: boolean;
  fullscreenRequired: boolean;
  strictMode: boolean;
  desktopRequired: boolean;
  switchAction: SwitchAction;
  cameraFailureAction: CameraFailureAction;
  maxFaceAbsenceWarnings: number;
  maxMultiFaceWarnings: number;
  maxPhoneWarnings: number;
  faceAbsenceThresholdMs: number;
  multiFacePersistenceMs: number;
  phonePersistenceMs: number;
  phoneConfidence: number;
  recoveryMs: number;
  fullscreenGraceMs: number;
  cameraGraceMs: number;
  warningCooldownMs: number;
}

export const DEFAULT_PROCTORING_POLICY: ProctoringPolicy = {
  enabled: false, version: 1, cameraRequired: true, faceMonitoring: true, multiFaceMonitoring: true, phoneDetection: true,
  fullscreenRequired: true, strictMode: false, desktopRequired: false,
  switchAction: 'WARN_AND_REQUIRE_FULLSCREEN', cameraFailureAction: 'BLOCK_UNTIL_RESTORED',
  maxFaceAbsenceWarnings: 5, maxMultiFaceWarnings: 3, maxPhoneWarnings: 2,
  faceAbsenceThresholdMs: 4000, multiFacePersistenceMs: 2500, phonePersistenceMs: 1500, phoneConfidence: 0.5,
  recoveryMs: 1500, fullscreenGraceMs: 10000, cameraGraceMs: 60000, warningCooldownMs: 5000,
};

export type ClientEventType =
  | 'FACE_MISSING' | 'MULTIPLE_FACES' | 'MOBILE_PHONE_DETECTED'
  | 'FULLSCREEN_EXIT' | 'FULLSCREEN_NOT_RESTORED' | 'TAB_SWITCH' | 'WINDOW_BLUR' | 'COPY_PASTE'
  | 'CAMERA_DISCONNECTED' | 'CAMERA_UNAVAILABLE' | 'CAMERA_NOT_RESTORED' | 'CAMERA_RESTORED' | 'VIDEO_FEED_STALLED';

export type TerminationReason =
  | 'FACE_ABSENCE_LIMIT' | 'MULTIPLE_FACES_LIMIT' | 'MOBILE_PHONE_REPEATED' | 'STRICT_POLICY_VIOLATION' | 'CAMERA_FAILURE'
  | 'EXAM_TIMEOUT' | 'MANUAL_SUBMISSION';

export type ProctoringStatus = 'NOT_FLAGGED' | 'MONITORING_EVENTS' | 'FLAGGED_FOR_REVIEW' | 'AUTO_SUBMITTED' | 'REVIEWED';
export type ReviewOutcome = 'NO_ISSUE' | 'CONCERN_CONFIRMED' | 'INCONCLUSIVE';

export interface ProctoringCounts {
  faceAbsence: number; multiFace: number; phone: number; fullscreenExit: number; tabSwitch: number;
  windowBlur: number; camera: number; network: number; copyPaste: number;
}

export interface SessionState {
  sessionId: string;
  status: 'ACTIVE' | 'COMPLETED';
  proctoringStatus: ProctoringStatus;
  counts: ProctoringCounts;
  limits: { faceAbsence: number; multiFace: number; phone: number };
  policy: ProctoringPolicy;
  terminated: boolean;
  terminationReason: TerminationReason | null;
  terminationText: string | null;
  autoSubmitted: boolean;
}

export interface ClientEvent {
  clientEventId: string;
  type: ClientEventType;
  occurredAt: string;
  confidence?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ProctoringSummary {
  sessionId: string;
  proctoringStatus: ProctoringStatus;
  counts: ProctoringCounts;
  limits: { faceAbsence: number; multiFace: number; phone: number };
  terminationReason: TerminationReason | null;
  terminationText: string | null;
  terminatedAt: string | null;
  reviewRequired: boolean;
  review: { outcome: ReviewOutcome; reviewedAt: string } | null;
}

export interface ReviewEvent {
  type: string; severity: 'info' | 'warning' | 'violation' | 'critical'; source: 'client' | 'server'; counted: boolean;
  warningNumber?: number; maxWarnings?: number; confidence?: number; occurredAt: string; metadata?: Record<string, unknown>;
}

export interface ReviewDetail extends ProctoringSummary {
  examKind: ExamKind;
  examTitle: string;
  student: { _id: string; name: string; email: string } | null;
  policy: ProctoringPolicy;
  policyVersion: number;
  startedAt: string;
  status: 'ACTIVE' | 'COMPLETED';
  precheck?: { passedAt?: string; faceCount?: number; fullscreen?: boolean; mobileDevice?: boolean; detector?: string };
  events: ReviewEvent[];
  reviewHistory: { by: string; byRole: string; at: string; outcome: ReviewOutcome; note?: string }[];
}

export const TERMINATION_LABEL: Record<TerminationReason, string> = {
  FACE_ABSENCE_LIMIT: 'Maximum face-absence warnings reached.',
  MULTIPLE_FACES_LIMIT: 'Multiple faces repeatedly detected.',
  MOBILE_PHONE_REPEATED: 'Mobile phone repeatedly detected.',
  STRICT_POLICY_VIOLATION: 'Strict examination policy violation.',
  CAMERA_FAILURE: 'The camera could not be restored.',
  EXAM_TIMEOUT: 'The time limit was reached.',
  MANUAL_SUBMISSION: 'Submitted by the student.',
};

export const SHORT_TERMINATION: Record<TerminationReason, string> = {
  FACE_ABSENCE_LIMIT: 'Face absence',
  MULTIPLE_FACES_LIMIT: 'Multiple faces',
  MOBILE_PHONE_REPEATED: 'Mobile phone',
  STRICT_POLICY_VIOLATION: 'Strict policy',
  CAMERA_FAILURE: 'Camera failure',
  EXAM_TIMEOUT: 'Time limit',
  MANUAL_SUBMISSION: 'Manual',
};
