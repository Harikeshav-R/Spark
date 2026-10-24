# ADR 0007: Persist-Before-Publish Real-Time Delivery & Recovery

## Status
Accepted

## Context
During live lectures and peer collaboration, events (transcript chunks, detected concepts, poll activations, chat messages) must be broadcast to connected clients. In real-time architectures, broadcasting before database persistence risks emitting events that subsequently fail to commit, leaving client state inconsistent with database truth. Furthermore, temporary mobile network drops or tab refreshes cause clients to miss events.

## Decision
We enforce a strict **persist-before-publish** invariant:
1. **Durable Persistence Precedes Broadcast**: Every domain mutation (transcript chunk, poll response, chat message, mastery evidence) MUST be committed to PostgreSQL before its corresponding WebSocket event is emitted via Socket.IO.
2. **At-Most-Once WebSocket Transport**: Socket.IO delivery is acknowledged as at-most-once over ephemeral connections. We do not claim distributed exactly-once delivery across process boundaries.
3. **State Snapshot Recovery**: Reconnecting clients or clients that miss events MUST NOT rely on server replay of missed socket packets. Instead, reconnecting clients call authenticated HTTP snapshot endpoints (e.g., `GET /api/lectures/:lectureId/snapshot` or `GET /api/study-groups/:matchId/messages`) to hydrate full authoritative state.
4. **Idempotent Client Event Processing**: All server events contain an `eventId`, monotonic entity `version` or timestamp, and resource identifier, allowing clients to deduplicate incoming messages against already applied state.

## Why
- Eliminates phantom state where clients display poll questions or chat messages that failed to write to the database.
- Provides a clean, resilient recovery mechanism for intermittent network interruptions without maintaining complex distributed transaction logs.
- Decouples real-time transport reliability from database consistency.

## Consequences
- Broadcast latency is bounded by PostgreSQL write latency (typically < 15ms in local/dedicated environments).
- Frontend clients must implement snapshot reconciliation logic on socket reconnection (`connect` / `reconnect` events).
