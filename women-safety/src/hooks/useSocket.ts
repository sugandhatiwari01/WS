/**
 * useSocket — real-time Socket.IO client hook
 *
 * Connects to the backend with the user's JWT token.
 * Auto-joins rooms: user:{userId}, station:{stationId} (if police role)
 * Cleans up on sign-out.
 *
 * NOTE: requires socket.io-client. Install with:
 *   npx expo install socket.io-client
 */

import { useEffect, useRef, useCallback } from "react";
import { getToken } from "@/lib/api";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");

type Handler = (data: unknown) => void;

export function useSocket({
  userId,
  stationId,
  onEvent,
}: {
  userId?: string;
  stationId?: string;
  onEvent: (event: string, data: unknown) => void;
}) {
  // We dynamically import socket.io-client to avoid crashing if it's not installed.
  const socketRef = useRef<{ on: (e: string, h: Handler) => void; off: (e: string, h: Handler) => void; disconnect: () => void } | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(async () => {
    if (!API_URL || !userId) return;

    let io: ((url: string, opts: object) => typeof socketRef.current) | null = null;
    try {
      // Dynamic import — won't crash if package not installed, just silently skips
      const mod = await import("socket.io-client" as string);
      io = mod.io ?? mod.default;
    } catch {
      // socket.io-client not installed — real-time disabled, polling fallback used
      console.warn("[useSocket] socket.io-client not installed. Run: npx expo install socket.io-client");
      return;
    }

    const token = await getToken();
    if (!token || !io) return;

    const socket = io(API_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    if (!socket) return;

    // Join relevant rooms
    const rooms: string[] = [];
    if (userId) rooms.push(`user:${userId}`);
    if (stationId) rooms.push(`station:${stationId}`);

    const eventNames = [
      "family:emergency",
      "emergency:new",
      "emergency:cancelled",
      "emergency:escalated",
      "incident:claimed",
      "location:update",
      "connect",
      "disconnect",
    ];

    for (const ev of eventNames) {
      socket.on(ev, (data: unknown) => onEventRef.current(ev, data));
    }

    if (socket) socketRef.current = socket as typeof socketRef.current;
  }, [userId, stationId]);

  useEffect(() => {
    void connect();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [connect]);
}
