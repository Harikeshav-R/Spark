# ADR 0002: Persistent Node Server with Express & Socket.IO

## Status
Accepted

## Context
Educational collaboration requires continuous, low-latency, bidirectional communication: streaming lecture transcript chunks, synchronizing formative poll states, broadcasting concept detection highlights, and maintaining presence in peer study rooms. 

Serverless deployment targets (such as Vercel serverless functions) do not support persistent WebSocket connections, stateful in-memory presence tracking, or long-lived streaming sockets from Zoom RTMS. Running independent server processes alongside the frontend introduces unnecessary orchestration overhead.

## Decision
We host Express 5, Socket.IO 4, and Next.js 16 within a single persistent Node.js process managed by a custom entry point at `server/index.ts`. Express mounts all `/api/*` endpoints; Socket.IO binds to the underlying Node `http.Server`; and Next.js handles all frontend page rendering via `app.getRequestHandler()`. Shared services and event emitters are wired via constructor dependency injection at server startup.

We deploy this persistent process to dedicated container or virtual host infrastructure (such as Render) rather than serverless platforms.

## Why
- Enables stateful, in-memory reference-counted attendance tracking across client tabs.
- Supports long-lived Zoom RTMS socket streams without external proxy infrastructure.
- In single-node deployments, Express handlers emit real-time Socket.IO events directly through injected in-process publishers without requiring an external Redis pub/sub broker.
- Conforms to Next.js official custom server documentation: <https://github.com/vercel/next.js/blob/v16.1.6/docs/01-app/02-guides/custom-server.mdx>.

## Consequences
- Bypasses certain platform-specific serverless optimizations (e.g., Vercel Edge caching and automated route chunking).
- Deployments cannot rely on `next start` or `.next/standalone/server.js`; production execution requires `node dist/server/index.js` (or `npm start`).
- Horizontal multi-instance scaling in future iterations will require introducing an external Redis or PostgreSQL adapter for Socket.IO message broadcasting.
