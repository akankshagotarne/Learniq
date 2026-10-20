import React from 'react';
import type { ChatPlacement } from './logic';
import type { LiveViewport } from './viewport';

/**
 * Frame of the live room: exactly the VISIBLE viewport (so the keyboard never hides the composer or the control bar), header on top,
 * persistent control bar at the bottom. Children are laid out as a flex column.
 */
export const RoomFrame: React.FC<{ frame: LiveViewport['frame']; children: React.ReactNode }> = ({ frame, children }) => {
  const h = frame ? `${frame.height}px` : '100dvh';
  return (
    <div className="fixed left-0 right-0 flex flex-col bg-[#0b0d1a] text-white overflow-hidden" data-testid="live-room"
      style={{ top: frame ? frame.top : 0, height: h, ['--live-h' as any]: h }}>
      {children}
    </div>
  );
};

/**
 * Body of the room: the stage column and (when open) the class chat. One layout for every size, so video, chat and controls each get their own
 * space and never overlap:
 *  - closed                 -> the stage fills the body
 *  - open + 'docked'        -> row: stage | chat column
 *  - open + 'stacked'       -> column: stage on top (compact), chat fills the rest underneath
 * The chat element always renders in the same slot, so resizing / rotating / the keyboard never remounts it (typed text and scroll position stay).
 */
export const RoomBody: React.FC<{ chatOpen: boolean; placement: ChatPlacement; gallery?: boolean; stage: React.ReactNode; chat: React.ReactNode }> = ({ chatOpen, placement, gallery, stage, chat }) => {
  const stacked = chatOpen && placement === 'stacked';
  return (
    <div className={`flex-1 min-h-0 flex ${stacked ? 'flex-col' : ''}`} data-testid="room-body" data-chat={chatOpen ? placement : 'closed'}>
      <main className={`min-w-0 min-h-0 flex flex-col gap-2 p-2 relative ${stacked ? (gallery ? 'flex-none h-[38%]' : 'flex-none') : 'flex-1'}`}>{stage}</main>
      {chat}
    </div>
  );
};
