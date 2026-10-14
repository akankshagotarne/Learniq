import { useEffect, useRef } from 'react';
import { getSocket } from '../services/socket';

/**
 * Keeps a screen in step with the server: calls `refresh` when the backend pushes 'interview:changed' over the socket,
 * and on a slow timer as a safety net (sockets can drop). The pushed event carries no data - the screen re-reads the
 * authorised state over HTTP, so the server stays the only source of truth.
 */
export const useInterviewLive = (refresh: () => void, { pollMs = 8000, enabled = true }: { pollMs?: number; enabled?: boolean } = {}) => {
  const ref = useRef(refresh);
  ref.current = refresh;

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChanged = () => {
      if (timer) return; // coalesce bursts
      timer = setTimeout(() => { timer = null; ref.current(); }, 150);
    };
    socket.on('interview:changed', onChanged);
    socket.on('connect', onChanged);
    const poll = setInterval(() => ref.current(), pollMs);
    return () => {
      socket.off('interview:changed', onChanged);
      socket.off('connect', onChanged);
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, pollMs]);
};
