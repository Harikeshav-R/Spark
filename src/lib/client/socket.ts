import { io, type Socket } from "socket.io-client";
import type { ServerToClientEvents, ClientToServerEvents } from "@/contracts/realtime";

export type LectureSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Creates an un-connected, authenticated Socket.IO client instance for live classroom feeds.
 * Uses same-origin default transport with explicit auth payload and autoConnect: false.
 */
export function createLectureSocket(token: string): LectureSocket {
  return io({
    autoConnect: false,
    auth: {
      token,
    },
  });
}
