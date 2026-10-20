/**
 * Automated-test page (only routed in the `--mode e2e` build): renders the REAL live-class stage, chat panel, control bar and room layout with
 * generated video so the layout can be checked at phone / tablet / desktop sizes without a signalling server.
 *   /__e2e/live-stage?mode=camera|screen&cam=on|off&chat=open|closed&msgs=<n>&fail=1
 * The generated frame is 16:9 with bright markers at its far left and right edges, so any cropping of the camera frame is detectable.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MainStage, StageBox, Tile } from '../../features/live/Stage';
import { chatPresentation, chooseStage } from '../../features/live/logic';
import { ChatPanel } from '../../features/live/ChatPanel';
import { ControlBar } from '../../features/live/ControlBar';
import { RoomBody, RoomFrame } from '../../features/live/RoomLayout';
import { useLiveViewport } from '../../features/live/viewport';
import type { ChatItem, RoomParticipant } from '../../features/live/types';

const makeStream = (label: string, hue: number): MediaStream | null => {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext('2d'); if (!ctx || !(canvas as any).captureStream) return null;
  const paint = () => {
    ctx.fillStyle = `hsl(${hue} 40% 30%)`; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 24, 360);        // far-left marker
    ctx.fillStyle = '#00ff00'; ctx.fillRect(616, 0, 24, 360);      // far-right marker
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText(label, 60, 190);
  };
  paint(); window.setInterval(paint, 200);
  return (canvas as any).captureStream(10) as MediaStream;
};

const P = (socketId: string, name: string, extra: Partial<RoomParticipant> = {}): RoomParticipant => ({ socketId, userId: `u-${socketId}`, name, role: 'student', isHost: false, isTeacher: false, isCameraOn: false, isMicOn: true, isScreenSharing: false, ...extra });

const LiveStageHarness: React.FC = () => {
  const q = new URLSearchParams(window.location.search);
  const screen = q.get('mode') === 'screen';
  const camOn = q.get('cam') !== 'off';
  const failSend = q.get('fail') === '1';
  const [chatOpen, setChatOpen] = useState(q.get('chat') === 'open');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatItem[]>(() => Array.from({ length: Number(q.get('msgs') || 0) }, (_, i) => ({
    _id: `m${i}`, senderName: i % 3 === 0 ? 'Nikhil Sir' : 'Student Two', senderRole: i % 3 === 0 ? 'teacher' : 'student', message: `Message number ${i + 1} - a reasonably long line so that it wraps on a narrow phone screen`, createdAt: new Date(2026, 9, 20, 10, i % 60).toISOString(),
  })));
  const [streams, setStreams] = useState<{ cam: MediaStream | null; screen: MediaStream | null }>({ cam: null, screen: null });
  useEffect(() => { setStreams({ cam: makeStream('CAMERA', 200), screen: makeStream('SCREEN', 20) }); }, []);
  const { width, landscape, frame } = useLiveViewport();
  const placement = chatPresentation(width, landscape);
  const stackedChat = chatOpen && placement === 'stacked';

  const participants = useMemo(() => [
    P('H', 'Nikhil Sir', { isHost: true, isTeacher: true, role: 'teacher', isCameraOn: camOn, isScreenSharing: screen }),
    P('S1', 'Student One'), P('S2', 'Student Two'),
  ], [camOn, screen]);
  const stage = { mode: 'everyone', layout: 'speaker', hostSocketId: 'H', screenShareSocketId: screen ? 'H' : null, spotlightSocketId: null, featuredSocketIds: [] } as any;
  const choice = chooseStage(stage, participants);
  const thumbs = participants.filter((p) => p.socketId !== choice.socketId);
  const noop = () => undefined;

  const send = async (text: string) => {
    if (failSend) return { ok: false };
    setMessages((m) => [...m, { _id: `n${m.length}`, senderName: 'Student One', senderRole: 'student', message: text, createdAt: new Date().toISOString() }]);
    return { ok: true };
  };

  return (
    <RoomFrame frame={frame}>
      <header className="flex-shrink-0 flex items-center gap-2 px-3 min-h-[48px] bg-white text-black">LIVE · harness</header>
      <RoomBody chatOpen={chatOpen} placement={placement}
        chat={chatOpen && <ChatPanel mode={placement} messages={messages} canChat chatMode="everyone" isHost={false} onSend={send} onClose={() => setChatOpen(false)} draft={draft} onDraftChange={setDraft} />}
        stage={(
          <>
            <StageBox compact={stackedChat}>
              <MainStage choice={choice} participants={participants} streams={{ H: streams.cam as MediaStream }} screens={screen && streams.screen ? { H: streams.screen } : {}}
                selfSocketId="S1" selfStream={null} selfCamOn={false} hostPresent hostName="Nikhil Sir" reconnecting={false} isHost={false} sharing={false} />
            </StageBox>
            <div className={`flex-shrink-0 flex gap-2 overflow-x-auto pb-1 ${stackedChat ? 'hidden' : ''}`} data-testid="thumbnails">
              {thumbs.map((p) => (
                <div key={p.socketId} className="w-24 h-16 flex-shrink-0">
                  <Tile p={p} compact stream={null} isSelf={p.socketId === 'S1'} selfStream={null} selfCamOn={false} selfMicOn className="w-full h-full" />
                </div>
              ))}
            </div>
          </>
        )} />
      <div data-testid="controls">
        <ControlBar isMicOn={false} isCamOn={false} isSharing={false} canAudio canVideo canScreen={false} screenSupported={false} chatOpen={chatOpen} unread={0} peopleOpen={false} waiting={0}
          isHost={false} mcqActive={false} onMic={noop} onCam={noop} onScreen={noop} onChat={() => setChatOpen((v) => !v)} onPeople={noop} onReaction={noop} onScoreboard={noop} onMcq={noop}
          onSettings={noop} onEnd={noop} onLeave={noop} />
      </div>
    </RoomFrame>
  );
};
export default LiveStageHarness;
