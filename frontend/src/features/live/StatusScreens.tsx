import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader, LogOut, ShieldCheck, UserX, WifiOff, Radio, VideoOff, MicOff, MonitorX } from 'lucide-react';
import type { MediaIssue, Connection } from './useLiveRoom';

const Shell: React.FC<{ children: React.ReactNode; testId: string }> = ({ children, testId }) => (
  <div data-testid={testId} className="fixed inset-0 flex items-center justify-center bg-page px-4 py-6 overflow-y-auto pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
    <div className="w-full max-w-sm text-center">{children}</div>
  </div>
);
const Icon: React.FC<{ tone?: 'brand' | 'warn' | 'bad' | 'ok'; children: React.ReactNode }> = ({ tone = 'brand', children }) => (
  <div className={`mx-auto mb-4 w-16 h-16 rounded-2xl flex items-center justify-center ${tone === 'warn' ? 'bg-amber-100 text-amber-600' : tone === 'bad' ? 'bg-rose-100 text-rose-600' : tone === 'ok' ? 'bg-emerald-100 text-emerald-600' : 'bg-brand-primary/10 text-brand-primary'}`}>{children}</div>
);
const Btn: React.FC<{ onClick: () => void; children: React.ReactNode; secondary?: boolean }> = ({ onClick, children, secondary }) => (
  <button onClick={onClick} className={`${secondary ? 'btn-outline' : 'btn-primary'} min-h-[44px] w-full mt-3 text-sm`}>{children}</button>
);

export const JoiningScreen: React.FC<{ title?: string; step: 'loading' | 'joining'; admin?: boolean }> = ({ title, step, admin }) => (
  <Shell testId="screen-joining">
    <Icon><Loader className="w-7 h-7 animate-spin" /></Icon>
    <h1 className="font-heading text-lg font-bold text-text-primary">{step === 'loading' ? (admin ? 'Checking your administrator access…' : 'Opening your class…') : (admin ? 'Joining the live meeting as a moderator…' : 'Joining the classroom…')}</h1>
    {title && <p className="text-text-secondary text-sm mt-1">{title}</p>}
    <p className="text-text-muted text-xs mt-3" role="status">Checking your account and connecting securely.</p>
  </Shell>
);

export const WaitingApprovalScreen: React.FC<{ title?: string; hostPresent: boolean; onLeave: () => void }> = ({ title, hostPresent, onLeave }) => (
  <Shell testId="screen-waiting">
    <Icon tone="warn"><Clock className="w-7 h-7" /></Icon>
    <h1 className="font-heading text-lg font-bold text-text-primary">{hostPresent ? 'Waiting for the teacher to let you in' : 'Waiting for the teacher to arrive'}</h1>
    {title && <p className="text-text-secondary text-sm mt-1">{title}</p>}
    <p className="text-text-muted text-sm mt-3" role="status">{hostPresent ? 'Your request was sent. This page will open the class as soon as you are admitted.' : "The teacher hasn't joined yet. Stay on this page - you will be let in when the class starts."}</p>
    <Btn secondary onClick={onLeave}>Leave</Btn>
  </Shell>
);

export const BlockedScreen: React.FC<{ kind: 'denied' | 'removed' | 'replaced' | 'error'; message: string; onLeave: () => void; onRetry?: () => void }> = ({ kind, message, onLeave, onRetry }) => (
  <Shell testId={`screen-${kind}`}>
    <Icon tone={kind === 'replaced' ? 'warn' : 'bad'}>{kind === 'error' ? <AlertTriangle className="w-7 h-7" /> : <UserX className="w-7 h-7" />}</Icon>
    <h1 className="font-heading text-lg font-bold text-text-primary">{kind === 'denied' ? "You can't join this class" : kind === 'removed' ? 'You were removed from the class' : kind === 'replaced' ? 'Class opened somewhere else' : "We couldn't open this class"}</h1>
    <p className="text-text-secondary text-sm mt-2" role="alert">{message}</p>
    {kind === 'error' && onRetry && <Btn onClick={onRetry}>Try again</Btn>}
    <Btn secondary onClick={onLeave}>Back to live classes</Btn>
  </Shell>
);

export const EndedScreen: React.FC<{ message: string; onLeave: () => void }> = ({ message, onLeave }) => (
  <Shell testId="screen-ended">
    <Icon tone="ok"><CheckCircle2 className="w-7 h-7" /></Icon>
    <h1 className="font-heading text-lg font-bold text-text-primary">Class ended</h1>
    <p className="text-text-secondary text-sm mt-2">{message}</p>
    <Btn onClick={onLeave}>Back to live classes</Btn>
  </Shell>
);

export const UseConsoleScreen: React.FC<{ url: string; onOpen: () => void; onLeave: () => void }> = ({ onOpen, onLeave }) => (
  <Shell testId="screen-use-console">
    <Icon><ShieldCheck className="w-7 h-7" /></Icon>
    <h1 className="font-heading text-lg font-bold text-text-primary">Open the moderation console</h1>
    <p className="text-text-secondary text-sm mt-2">Administrators oversee live classes from the Administrative Moderation Console. You will not appear as a participant and your video is never shared.</p>
    <Btn onClick={onOpen}>Open console</Btn>
    <Btn secondary onClick={onLeave}>Back</Btn>
  </Shell>
);

/** Thin banner under the header: connection trouble must be visible, never silent. */
export const ConnectionBanner: React.FC<{ connection: Connection }> = ({ connection }) => {
  if (connection === 'online') return null;
  return (
    <div role="status" aria-live="polite" data-testid="connection-banner" className="flex-shrink-0 flex items-center justify-center gap-2 bg-amber-500/95 text-black text-xs font-semibold px-3 py-1.5">
      {connection === 'reconnecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <WifiOff className="w-3.5 h-3.5" />}
      {connection === 'reconnecting' ? 'Connection lost - reconnecting… Your place in the class is kept.' : 'You are offline. Check your internet connection.'}
    </div>
  );
};

export const MediaIssueBanner: React.FC<{ issue: MediaIssue; onDismiss: () => void }> = ({ issue, onDismiss }) => {
  if (!issue) return null;
  const map = {
    'camera-denied': { icon: <VideoOff className="w-4 h-4" />, text: 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.' },
    'camera-missing': { icon: <VideoOff className="w-4 h-4" />, text: 'No camera was found on this device.' },
    'mic-denied': { icon: <MicOff className="w-4 h-4" />, text: 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.' },
    'screen-denied': { icon: <MonitorX className="w-4 h-4" />, text: 'Screen sharing was cancelled or is not allowed by this browser.' },
  }[issue];
  return (
    <div role="alert" data-testid="media-issue" className="flex-shrink-0 flex items-start gap-2 bg-rose-50 text-rose-700 border-b border-rose-200 text-xs px-3 py-2">
      <span className="mt-0.5">{map.icon}</span><span className="flex-1">{map.text}</span>
      <button onClick={onDismiss} className="underline font-semibold min-h-[24px]">Dismiss</button>
    </div>
  );
};

export const HostAwayChip: React.FC = () => (
  <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium"><Radio className="w-3 h-3" />Teacher is away</span>
);
export { LogOut };
