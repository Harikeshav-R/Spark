import http from "node:http";
import express from "express";
import type { Express, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";

export interface ServerInstance {
  app: Express;
  httpServer: http.Server;
  io: SocketIOServer;
}

export function createServer(): ServerInstance {
  const app = express();
  app.use(express.json());

  // Base preflight healthcheck endpoint
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  const httpServer = http.createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.APP_ORIGIN || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

  return { app, httpServer, io };
}

export async function startServer(port = Number(process.env.PORT) || 3000): Promise<ServerInstance> {
  const instance = createServer();
  const { promise, resolve } = Promise.withResolvers<ServerInstance>();

  instance.httpServer.listen(port, () => {
    console.log(`[server] Classroom Companion composition root running on http://localhost:${port}`);
    resolve(instance);
  });

  const shutdown = () => {
    console.log("[server] Shutting down gracefully...");
    instance.io.close();
    instance.httpServer.close(() => {
      console.log("[server] HTTP and WebSocket server closed.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return promise;
}

// Direct execution guard
if (process.env.NODE_ENV !== "test" && process.argv[1]?.endsWith("server/index.ts")) {
  void startServer();
}
