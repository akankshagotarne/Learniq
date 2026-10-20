/**
 * Pure helpers for the live classroom (no React, no DOM) so the rules can be unit-tested.
 * Timing rule: the SERVER decides when a question opens and closes. The client only converts the "milliseconds left" it was told into a
 * deadline on its own MONOTONIC clock (performance.now), so a wrong device clock or a clock change can never extend or cut the window.
 */
import type { PeerPlanEntry, RoomParticipant, StageInfo } from './types';

export type Clock = () => number;
export const monotonic: Clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** local monotonic deadline for something that ends in `remainingMs` */
export const deadlineFrom = (remainingMs: number, now: Clock = monotonic): number => now() + Math.max(0, remainingMs);
export const msLeft = (deadline: number, now: Clock = monotonic): number => Math.max(0, Math.ceil(deadline - now()));
/** the number shown on the countdown: whole seconds, rounded UP (14.2 s left shows 15), never negative */
export const secondsLeft = (deadline: number, now: Clock = monotonic): number => Math.ceil(msLeft(deadline, now) / 1000);
/** progress ring / bar 0..1 */
export const fractionLeft = (deadline: number, durationMs: number, now: Clock = monotonic): number => (durationMs > 0 ? Math.min(1, msLeft(deadline, now) / durationMs) : 0);

/** "2.4 sec" - the same wording the server uses on the rank card */
export const secLabel = (ms: number): string => `${(Math.round(ms / 100) / 10).toFixed(1)} sec`;

export type StageKind = 'screen' | 'spotlight' | 'host' | 'none';
export interface StageChoice { kind: StageKind; socketId: string | null }

/**
 * What goes on the MAIN stage. Priority: an active screen share, then the spotlit person, then the host's camera.
 * A student never gets another student's tile as the main stage unless the host spotlighted them.
 */
export const chooseStage = (stage: StageInfo | null, participants: RoomParticipant[]): StageChoice => {
  if (!stage) return { kind: 'none', socketId: null };
  const exists = (id: string | null) => !!id && participants.some((p) => p.socketId === id);
  if (exists(stage.screenShareSocketId)) return { kind: 'screen', socketId: stage.screenShareSocketId };
  if (stage.mode === 'spotlight' && exists(stage.spotlightSocketId)) return { kind: 'spotlight', socketId: stage.spotlightSocketId };
  if (exists(stage.hostSocketId)) return { kind: 'host', socketId: stage.hostSocketId };
  return { kind: 'none', socketId: null };
};

/** People shown in the thumbnail strip: not the stage, and (for a student) only those the server lists / the plan connects to */
export const thumbnailsFor = (participants: RoomParticipant[], stage: StageChoice, selfSocketId: string | undefined, peers: PeerPlanEntry[], isHostView: boolean): RoomParticipant[] => {
  const receivable = new Set(peers.filter((p) => p.receive).map((p) => p.socketId));
  return participants.filter((p) => {
    if (p.socketId === stage.socketId) return false;
    if (p.socketId === selfSocketId) return true;
    return isHostView || receivable.has(p.socketId);
  });
};

export type StageState = 'screen' | 'camera' | 'camera-off' | 'connecting' | 'host-away';
/** What the main stage must explain to the viewer when there is no live picture to show. */
export const stageState = (choice: StageChoice, host: RoomParticipant | undefined, hasStream: boolean, hostPresent: boolean): StageState => {
  if (!hostPresent && choice.kind !== 'screen') return 'host-away';
  if (choice.kind === 'none') return hostPresent ? 'connecting' : 'host-away';
  const target = choice.kind === 'host' ? host : undefined;
  if (hasStream && (choice.kind === 'screen' || choice.kind === 'spotlight' || target?.isCameraOn)) return choice.kind === 'screen' ? 'screen' : 'camera';
  if (choice.kind === 'screen') return 'connecting';
  if (target && !target.isCameraOn) return 'camera-off';
  return 'connecting';
};

/** Tailwind-independent breakpoints used for the chat presentation */
export const chatPresentation = (width: number): 'docked' | 'slideover' | 'sheet' => (width >= 1024 ? 'docked' : width >= 640 ? 'slideover' : 'sheet');

export const initials = (name: string): string => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
