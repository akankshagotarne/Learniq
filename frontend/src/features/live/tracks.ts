/**
 * Which media section of a peer connection carries what. Every connection has the same three sections, in this order:
 *   0 = microphone audio, 1 = camera video, 2 = screen-share video.
 * Keeping the camera and the screen in SEPARATE sections lets a student receive both at once (screen as the main content, the teacher's
 * camera as a picture-in-picture) without publishing a second participant or a duplicate camera track.
 * Pure helpers (no DOM, no WebRTC objects) so the rules can be unit-tested.
 */
export type Slot = 'audio' | 'camera' | 'screen';
export const SLOT_ORDER: Slot[] = ['audio', 'camera', 'screen'];

export const slotOfIndex = (index: number): Slot | null => (index >= 0 && index < SLOT_ORDER.length ? SLOT_ORDER[index] : null);

/** an older client only negotiates audio + one video section: the screen then has to use the camera's video section (as it always did) */
export const isLegacyPeer = (sectionCount: number): boolean => sectionCount < SLOT_ORDER.length;

export interface Outgoing<T> { audio: T | null; video: T | null; screen: T | null; blankVideo: T | null; blankAudio: T | null }

/**
 * The track to put on a section.
 *  - A peer we may not SEND to only ever gets an inert placeholder (or nothing): no real media in a disallowed direction.
 *  - screen section: the screen track, or NOTHING while no screen is shared (an idle section carries no frames).
 *  - legacy peer: screen share replaces the camera picture in the one video section.
 */
export const trackForSlot = <T>(slot: Slot, o: Outgoing<T>, canSend: boolean, legacy: boolean): T | null => {
  if (slot === 'audio') return canSend ? (o.audio || o.blankAudio) : o.blankAudio;
  if (slot === 'camera') {
    if (!canSend) return o.blankVideo;
    return legacy ? (o.screen || o.video || o.blankVideo) : (o.video || o.blankVideo);
  }
  return canSend && !legacy ? o.screen : null;
};
