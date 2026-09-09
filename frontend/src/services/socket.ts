import { io, Socket } from 'socket.io-client';

const getSocketUrl = (): string => {
  const socketUrl = import.meta.env.VITE_SOCKET_URL;
  if (socketUrl && typeof socketUrl === 'string' && socketUrl.trim()) {
    return socketUrl.trim().replace(/\/$/, '');
  }
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl && typeof apiUrl === 'string' && apiUrl.trim()) {
    return apiUrl.trim().replace(/\/api\/?$/, '').replace(/\/$/, '');
  }
  return 'http://localhost:5000';
};

const SOCKET_URL = getSocketUrl();

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  const token = localStorage.getItem('learniq_token');

  if (!socket) {
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log(`[Socket] Connected to ${SOCKET_URL} with ID: ${socket?.id}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Disconnected: ${reason}`);
    });

    socket.on('connect_error', (err) => {
      console.warn(`[Socket] Connection error to ${SOCKET_URL}:`, err.message);
    });
  } else if (token && socket.auth && (socket.auth as any).token !== token) {
    // Synchronize token if refreshed
    (socket.auth as any).token = token;
    if (!socket.connected) {
      socket.connect();
    }
  }

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const reconnectSocket = () => {
  disconnectSocket();
  return getSocket();
};

export default getSocket;
