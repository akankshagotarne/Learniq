import React, { useCallback, useEffect, useRef, useState } from 'react';

/** <video> for a MediaStream. A portrait source is letterboxed (object-contain) instead of cropped to a sliver; the measured frame wins over any hint. */
export const StreamVideo: React.FC<{ stream: MediaStream | null; muted?: boolean; className?: string; isPortrait?: boolean; contain?: boolean; mirror?: boolean; label?: string }> = ({
  stream, muted = true, className = 'w-full h-full', isPortrait, contain = false, mirror = false, label,
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [measured, setMeasured] = useState<boolean | null>(null);

  useEffect(() => {
    const v = ref.current; if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => { /* autoplay blocked: the first tap on the page starts it */ });
  }, [stream]);

  useEffect(() => {
    const v = ref.current; if (!v) return undefined;
    let got = false;
    const read = () => { if (v.videoWidth && v.videoHeight) { got = true; setMeasured(v.videoHeight > v.videoWidth); } };
    v.addEventListener('loadedmetadata', read); v.addEventListener('resize', read); read();
    const poll = window.setInterval(() => { if (got) window.clearInterval(poll); else read(); }, 300);
    const stop = window.setTimeout(() => window.clearInterval(poll), 8000);
    return () => { v.removeEventListener('loadedmetadata', read); v.removeEventListener('resize', read); window.clearInterval(poll); window.clearTimeout(stop); };
  }, [stream]);

  const portrait = measured !== null ? measured : !!isPortrait;
  const fit = contain || portrait ? 'object-contain' : 'object-cover';
  return <video ref={ref} autoPlay playsInline muted={muted} aria-label={label} className={`${className} ${fit} ${mirror ? '-scale-x-100' : ''}`} />;
};

/**
 * One remote audio element. The browser may refuse automatic playback (autoplay policy); then `onBlocked(true)` is reported so the page can
 * show an "Enable audio" button, and ANY tap / key press (or that button) starts the sound. `onBlocked(false)` is reported once it plays.
 * Each remote stream has exactly one element and the stream is attached once (never twice), and it is detached when the stream goes away.
 */
const Audio: React.FC<{ id: string; stream: MediaStream; onBlocked: (id: string, blocked: boolean) => void }> = ({ id, stream, onBlocked }) => {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current; if (!a) return undefined;
    if (a.srcObject !== stream) a.srcObject = stream;
    const start = () => a.play().then(() => onBlocked(id, false)).catch(() => onBlocked(id, true));
    const unlock = () => { start(); };
    const onTrack = () => { start(); };
    start();
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock); window.addEventListener('live-enable-audio', unlock);
    stream.addEventListener('addtrack', onTrack); stream.addEventListener('removetrack', onTrack);
    return () => {
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); window.removeEventListener('live-enable-audio', unlock);
      stream.removeEventListener('addtrack', onTrack); stream.removeEventListener('removetrack', onTrack);
      try { a.pause(); } catch { /* ignore */ }
      a.srcObject = null; onBlocked(id, false); // detach so a left participant's audio stops at once and nothing is held open
    };
  }, [id, stream, onBlocked]);
  return <audio ref={ref} autoPlay playsInline data-testid={`audio-${id}`} />;
};

/** Remote audio always plays, whatever tile is on screen. (Only streams the server's plan allows us to receive are ever passed in.) */
export const RemoteAudioPool: React.FC<{ streams: Record<string, MediaStream> }> = ({ streams }) => {
  const [blocked, setBlocked] = useState<Record<string, true>>({});
  const onBlocked = useCallback((id: string, isBlocked: boolean) => {
    setBlocked((b) => { if (isBlocked ? b[id] : !b[id]) return b; const n = { ...b }; if (isBlocked) n[id] = true; else delete n[id]; return n; });
  }, []);
  const needsTap = Object.keys(blocked).length > 0;
  return (
    <>
      <div style={{ display: 'none' }} aria-hidden="true">{Object.entries(streams).map(([id, s]) => <Audio key={id} id={id} stream={s} onBlocked={onBlocked} />)}</div>
      {needsTap && (
        <div className="fixed z-30 left-1/2 -translate-x-1/2 top-16 px-3 w-full max-w-sm pointer-events-none">
          <button type="button" data-testid="enable-audio" onClick={() => window.dispatchEvent(new Event('live-enable-audio'))}
            className="pointer-events-auto w-full min-h-[48px] rounded-2xl bg-amber-400 text-black text-sm font-bold shadow-xl px-4">🔊 Tap to enable class audio — your browser blocked automatic sound</button>
        </div>
      )}
    </>
  );
};
