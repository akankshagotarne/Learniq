import React, { useEffect, useRef, useState } from 'react';

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

const Audio: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current; if (!a) return undefined;
    a.srcObject = stream;
    let unlock: (() => void) | null = null;
    a.play().catch(() => {
      unlock = () => { a.play().catch(() => {}); window.removeEventListener('pointerdown', unlock!); window.removeEventListener('keydown', unlock!); };
      window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    });
    return () => { if (unlock) { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); } };
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
};

/** Remote audio always plays, whatever tile is on screen. (Only streams the server's plan allows us to receive are ever passed in.) */
export const RemoteAudioPool: React.FC<{ streams: Record<string, MediaStream> }> = ({ streams }) => (
  <div style={{ display: 'none' }} aria-hidden="true">{Object.entries(streams).map(([id, s]) => <Audio key={id} stream={s} />)}</div>
);
