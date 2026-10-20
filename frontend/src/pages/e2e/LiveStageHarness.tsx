/**
 * Automated-test page (only routed in the `--mode e2e` build): renders the REAL live-class stage with generated video so the layout can be
 * checked at phone / tablet / desktop sizes without a signalling server.  /__e2e/live-stage?mode=camera|screen&cam=on|off
 * The generated frame is 16:9 with bright markers at its far left and right edges, so any cropping of the camera frame is detectable.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MainStage, StageBox, Tile } from '../../features/live/Stage';
import { chooseStage } from '../../features/live/logic';
import type { RoomParticipant } from '../../features/live/types';

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
  const [streams, setStreams] = useState<{ cam: MediaStream | null; screen: MediaStream | null }>({ cam: null, screen: null });
  useEffect(() => { setStreams({ cam: makeStream('CAMERA', 200), screen: makeStream('SCREEN', 20) }); }, []);

  const participants = useMemo(() => [
    P('H', 'Nikhil Sir', { isHost: true, isTeacher: true, role: 'teacher', isCameraOn: camOn, isScreenSharing: screen }),
    P('S1', 'Student One'), P('S2', 'Student Two'),
  ], [camOn, screen]);
  const stage = { mode: 'everyone', layout: 'speaker', hostSocketId: 'H', screenShareSocketId: screen ? 'H' : null, spotlightSocketId: null, featuredSocketIds: [] } as any;
  const choice = chooseStage(stage, participants);
  const thumbs = participants.filter((p) => p.socketId !== choice.socketId);

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b0d1a] text-white overflow-hidden" style={{ height: '100dvh' }} data-testid="live-room">
      <header className="flex-shrink-0 flex items-center gap-2 px-3 min-h-[48px] bg-white text-black">LIVE · harness</header>
      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 p-2 relative">
          <StageBox>
            <MainStage choice={choice} participants={participants} streams={{ H: streams.cam as MediaStream }} screens={screen && streams.screen ? { H: streams.screen } : {}}
              selfSocketId="S1" selfStream={null} selfCamOn={false} hostPresent hostName="Nikhil Sir" reconnecting={false} isHost={false} sharing={false} />
          </StageBox>
          <div className="flex-shrink-0 flex gap-2 overflow-x-auto pb-1" data-testid="thumbnails">
            {thumbs.map((p) => (
              <div key={p.socketId} className="w-24 h-16 flex-shrink-0">
                <Tile p={p} compact stream={null} isSelf={p.socketId === 'S1'} selfStream={null} selfCamOn={false} selfMicOn className="w-full h-full" />
              </div>
            ))}
          </div>
        </main>
      </div>
      <nav className="flex-shrink-0 flex justify-center gap-2 p-2 bg-white" data-testid="controls"><button className="min-h-[44px] px-4 bg-gray-200 text-black rounded-xl">Mic</button><button className="min-h-[44px] px-4 bg-gray-200 text-black rounded-xl">Camera</button><button className="min-h-[44px] px-4 bg-gray-200 text-black rounded-xl">Leave</button></nav>
    </div>
  );
};
export default LiveStageHarness;
