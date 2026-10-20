import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toastLib from 'react-hot-toast';
import { Users, Radio, Crown, X, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLiveRoom } from '../../features/live/useLiveRoom';
import { chooseStage, chatPresentation, thumbnailsFor } from '../../features/live/logic';
import { MainStage, Tile } from '../../features/live/Stage';
import { RemoteAudioPool } from '../../features/live/media';
import { ChatPanel } from '../../features/live/ChatPanel';
import { ControlBar } from '../../features/live/ControlBar';
import { McqPopup, RankCard } from '../../features/live/McqPopup';
import { HostMcqPanel } from '../../features/live/HostMcqPanel';
import { ParticipantsPanel } from '../../features/live/ParticipantsPanel';
import { MeetingSettingsPanel, summarize } from '../../features/live/MeetingSettings';
import { ScoreboardModal, PodiumScreen } from '../../features/live/Podium';
import {
  BlockedScreen, ConnectionBanner, EndedScreen, HostAwayChip, JoiningScreen, MediaIssueBanner, UseConsoleScreen, WaitingApprovalScreen,
} from '../../features/live/StatusScreens';

/** viewport width, updated on resize / rotation (drives how the chat is presented) */
const useWidth = () => {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on); window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return w;
};

/**
 * Live class room - students and the teacher/host. The MAIN stage is always the teacher's camera or the active screen share (or the
 * spotlit person); chat, people and settings are secondary panels. All state and permissions come from the server (useLiveRoom).
 */
const LiveSessionPage: React.FC<{ adminMode?: boolean }> = ({ adminMode = false }) => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = useMemo(() => (user ? { _id: String((user as any)._id || (user as any).id), name: (user as any).name as string, role: (user as any).role as string } : null), [user]);
  const room = useLiveRoom(code, me, { asAdmin: adminMode });
  const isManager = room.isManager;
  const width = useWidth();
  const chatMode = chatPresentation(width);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mcqPanelOpen, setMcqPanelOpen] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [issueDismissed, setIssueDismissed] = useState(false);

  const leaveTo = adminMode ? `/admin/live/${encodeURIComponent(code || '')}` : user && (user as any).role === 'teacher' ? '/teacher/live' : '/live-sessions';
  const endedTo = adminMode ? '/admin/live' : leaveTo;
  const goBack = useCallback(() => { room.leave(); navigate(leaveTo); }, [room, navigate, leaveTo]);

  // toasts raised by the room logic (window event keeps the hook free of UI imports)
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail || {}; if (d.message) (d.error ? toastLib.error : toastLib.success)(d.message, { id: `live-${d.message}` }); };
    window.addEventListener('live-toast', on);
    return () => window.removeEventListener('live-toast', on);
  }, []);

  // safe-area support on notched phones while the room is open
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const prev = meta?.getAttribute('content') || null;
    if (meta && prev && !prev.includes('viewport-fit')) meta.setAttribute('content', `${prev}, viewport-fit=cover`);
    return () => { if (meta && prev) meta.setAttribute('content', prev); };
  }, []);

  useEffect(() => { if (!adminMode && room.status === 'use-console' && room.consoleUrl) navigate(room.consoleUrl, { replace: true }); }, [adminMode, room.status, room.consoleUrl, navigate]);
  useEffect(() => { setIssueDismissed(false); }, [room.mediaIssue]);
  // Escape closes the top-most panel (keyboard users are never trapped in a dialog)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (scoreboardOpen) setScoreboardOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (peopleOpen) setPeopleOpen(false);
      else if (mcqPanelOpen) setMcqPanelOpen(false);
      else if (room.chatOpen && width < 1024) room.openChat(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scoreboardOpen, settingsOpen, peopleOpen, mcqPanelOpen, room, width]);
  useEffect(() => { if (room.mcq.phase === 'open' && isManager) setMcqPanelOpen(true); }, [room.mcq.phase, isManager]);

  const selfSocketId = room.self?.socketId;
  const choice = useMemo(() => chooseStage(room.stage, room.participants), [room.stage, room.participants]);
  const thumbs = useMemo(() => thumbnailsFor(room.participants, choice, selfSocketId, room.peers, isManager), [room.participants, choice, selfSocketId, room.peers, isManager]);
  const gallery = room.config.layout === 'gallery' && choice.kind !== 'screen';
  const hostName = room.participants.find((p) => p.isHost)?.name;
  const title = room.sessionInfo?.title;

  if (!user) return <BlockedScreen kind="error" message="Please sign in to join the class." onLeave={() => navigate('/login')} />;
  if (adminMode && (user as any).role !== 'admin') return <BlockedScreen kind="denied" message="Only administrators can join a class as a moderator." onLeave={() => navigate('/')} />;
  if (room.status === 'loading') return <JoiningScreen title={title} step="loading" admin={adminMode} />;
  if (room.status === 'joining') return <JoiningScreen title={title} step="joining" admin={adminMode} />;
  if (room.status === 'use-console') return <UseConsoleScreen url={room.consoleUrl || '/admin/live'} onOpen={() => navigate(room.consoleUrl || '/admin/live')} onLeave={() => navigate('/admin/live')} />;
  if (room.status === 'waiting-approval') return <WaitingApprovalScreen title={title} hostPresent={room.hostPresent} onLeave={goBack} />;
  if (room.status === 'denied' || room.status === 'removed' || room.status === 'replaced' || room.status === 'error') {
    return <BlockedScreen kind={room.status} message={room.statusMessage} onLeave={() => navigate(adminMode ? '/admin/live' : leaveTo)} onRetry={room.status === 'error' ? room.retry : undefined} />;
  }
  if (room.status === 'ended') {
    return room.podium.length > 0
      ? <PodiumScreen podium={room.podium} selfUserId={room.self?.userId} message={room.statusMessage} onDone={() => navigate(endedTo)} />
      : <EndedScreen message={room.statusMessage} onLeave={() => navigate(endedTo)} />;
  }

  // student popup: only while the question is open and this student's answer has NOT been acknowledged by the server
  const showMcqPopup = !isManager && room.mcq.phase === 'open' && !!room.mcq.question && !room.mcq.submitted;
  const chatOpen = room.chatOpen && room.config.chatMode !== 'off';
  const chatDocked = chatOpen && chatMode === 'docked';
  const selfP = room.participants.find((p) => p.socketId === selfSocketId);
  const manager = isManager ? room.host : undefined;

  const chatPanel = chatOpen && (
    <ChatPanel mode={chatMode} messages={room.messages} canChat={room.permissions.canChat} chatMode={room.config.chatMode} isHost={isManager}
      onSend={room.sendChat} onClose={() => room.openChat(false)} onDelete={isManager ? room.host.deleteChat : undefined} />
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b0d1a] text-white overflow-hidden" style={{ height: '100dvh' }} data-testid="live-room">
      {/* header */}
      <header className="flex-shrink-0 flex items-center gap-2 px-3 min-h-[48px] bg-surface text-text-primary border-b border-border-subtle pt-[env(safe-area-inset-top)] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-600 text-[11px] font-bold px-2 py-0.5"><Radio className="w-3 h-3" />LIVE</span>
        <h1 className="flex-1 min-w-0 truncate font-heading font-semibold text-sm">{title || 'Live class'}</h1>
        {adminMode && <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 text-[11px] font-bold px-2 py-0.5" data-testid="admin-badge"><ShieldCheck className="w-3 h-3" />Admin moderator</span>}
        {!room.hostPresent && !room.isHost && <HostAwayChip />}
        <button onClick={() => setPeopleOpen((v) => !v)} aria-label="Participants" className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-text-secondary"><Users className="w-4 h-4" />{room.counts.students}</button>
      </header>
      <ConnectionBanner connection={room.connection} />
      {room.mediaIssue && !issueDismissed && <MediaIssueBanner issue={room.mediaIssue} onDismiss={() => setIssueDismissed(true)} />}
      {adminMode && (
        <div className="flex-shrink-0 px-3 py-1 text-[11px] bg-sky-50 text-sky-800" data-testid="admin-notice">You are in this class as <b>LearnIQ Admin (moderator)</b>. Everyone can see that you are here. Your microphone and camera are off until you switch them on. Nothing is recorded.</div>
      )}
      {isManager && room.config.mode !== 'everyone' && (
        <div className="flex-shrink-0 px-3 py-1 text-[11px] bg-brand-primary/10 text-brand-primary truncate" data-testid="mode-banner">{summarize(room.config)}</div>
      )}

      {/* body: stage first, chat only when opened */}
      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 p-2 relative">
          {!gallery ? (
            <>
              <div className="flex-1 min-h-0"><MainStage choice={choice} participants={room.participants} streams={room.remoteStreams} selfSocketId={selfSocketId} selfStream={room.localStream}
                selfCamOn={room.isCamOn || room.isSharing} hostPresent={room.hostPresent} hostName={hostName} reconnecting={room.connection !== 'online'} isHost={room.isHost} sharing={room.isSharing} /></div>
              {thumbs.length > 0 && (
                <div className="flex-shrink-0 flex gap-2 overflow-x-auto pb-1" data-testid="thumbnails" aria-label="Other participants">
                  {thumbs.slice(0, 12).map((p) => (
                    <div key={p.socketId} className="w-24 h-16 sm:w-28 sm:h-20 flex-shrink-0">
                      <Tile p={p} compact stream={room.remoteStreams[p.socketId] || null} isSelf={p.socketId === selfSocketId} selfStream={room.camStream} selfCamOn={room.isCamOn} selfMicOn={room.isMicOn} className="w-full h-full" />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 lg:grid-cols-3 gap-2 content-start" data-testid="gallery">
              {room.participants.filter((p) => p.socketId === selfSocketId || isManager || room.peers.some((x) => x.socketId === p.socketId && x.receive)).map((p) => (
                <div key={p.socketId} className="aspect-video">
                  <Tile p={p} stream={room.remoteStreams[p.socketId] || null} isSelf={p.socketId === selfSocketId} selfStream={room.camStream} selfCamOn={room.isCamOn} selfMicOn={room.isMicOn} className="w-full h-full" />
                </div>
              ))}
            </div>
          )}

          {/* floating reactions */}
          <div className="pointer-events-none absolute right-3 bottom-3 flex flex-col-reverse gap-1" aria-hidden="true">
            {room.reactions.slice(-4).map((r) => <span key={r.id} className="text-3xl animate-bounce">{r.emoji}</span>)}
          </div>

          {/* MCQ rank card: overlays the stage, fits any width */}
          {room.rank && <RankCard rank={room.rank} selfUserId={room.self?.userId} myResult={room.mcq.result} />}
        </main>

        {chatDocked && chatPanel}
      </div>

      <RemoteAudioPool streams={room.remoteStreams} />

      {/* host: question panel */}
      {isManager && mcqPanelOpen && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/50 sm:p-4">
          <div className="w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[90dvh] overflow-y-auto bg-surface text-text-primary rounded-t-3xl sm:rounded-3xl pb-[env(safe-area-inset-bottom)]">
            <HostMcqPanel mcq={room.mcq} host={room.hostMcq} onLaunch={room.launchMcq} onClose={room.closeMcq} onDismiss={() => setMcqPanelOpen(false)} />
          </div>
        </div>
      )}

      {/* student: question popup */}
      {showMcqPopup && <McqPopup mcq={room.mcq} online={room.connection === 'online'} onSelect={room.selectOption} onSubmit={room.submitMcq} />}

      {/* people */}
      {peopleOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setPeopleOpen(false)}>
          <div className="w-full sm:w-96 h-full bg-surface text-text-primary flex flex-col pt-[env(safe-area-inset-top)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Participants">
            <ParticipantsPanel participants={room.participants} selfSocketId={selfSocketId} config={room.config} manager={manager} waiting={isManager ? room.waiting : []}
              locked={room.counts.locked} onClose={() => setPeopleOpen(false)} onNotify={(m, e) => (e ? toastLib.error(m) : toastLib.success(m))} />
          </div>
        </div>
      )}

      {/* chat as slide-over / bottom sheet (the panel brings its own backdrop and close button) */}
      {chatOpen && chatMode !== 'docked' && chatPanel}

      {settingsOpen && isManager && (
        <MeetingSettingsPanel showAudience={!room.isAdmin} config={room.config} onApply={(patch, v) => room.host.updateConfig(patch, v) as any} onRevert={() => room.host.revertConfig() as any} onClose={() => setSettingsOpen(false)} />
      )}
      {scoreboardOpen && <ScoreboardModal scoreboard={room.scoreboard} selfUserId={room.self?.userId} onClose={() => setScoreboardOpen(false)} />}

      {/* teacher: permission request from a student */}
      {room.permRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="alertdialog" aria-label="Permission request">
          <div className="w-full max-w-sm bg-surface text-text-primary rounded-3xl p-5 text-center space-y-3">
            <p className="font-semibold text-sm">{room.permRequest.from} asks you to turn on your {room.permRequest.type === 'camera' ? 'camera' : 'microphone'}.</p>
            <div className="flex gap-2"><button className="btn-primary flex-1 min-h-[48px]" onClick={() => room.answerPermRequest(true)}>Turn on</button><button className="btn-outline flex-1 min-h-[48px]" onClick={() => room.answerPermRequest(false)}>Not now</button></div>
          </div>
        </div>
      )}

      <ControlBar
        isMicOn={room.isMicOn} isCamOn={room.isCamOn} isSharing={room.isSharing} canAudio={room.permissions.canAudio && !room.permissions.micBlocked}
        canVideo={room.permissions.canVideo && !room.permissions.cameraBlocked} canScreen={room.permissions.canScreen}
        screenSupported={typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices}
        chatOpen={chatOpen} unread={room.unread} peopleOpen={peopleOpen} waiting={room.waiting.length} isHost={isManager} isAdmin={room.isAdmin}
        mcqActive={room.mcq.phase === 'open'}
        onMic={() => room.toggleMic()} onCam={() => room.toggleCamera()} onScreen={() => room.toggleScreen()}
        onChat={() => room.openChat(!room.chatOpen)} onPeople={() => setPeopleOpen((v) => !v)} onReaction={room.sendReaction}
        onScoreboard={() => { room.getScoreboard(); setScoreboardOpen(true); }} onMcq={() => setMcqPanelOpen(true)} onSettings={() => setSettingsOpen(true)}
        onEnd={() => { room.host.end(); }} onLeave={goBack} onConsole={adminMode ? goBack : undefined}
      />
    </div>
  );
};

export default LiveSessionPage;
