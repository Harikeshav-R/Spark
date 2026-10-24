# Architecture Decisions Index

This document catalogues all Architecture Decision Records (ADRs) governing the design and implementation of HackOHIO Classroom Companion.

Per the domain documentation guidelines in `docs/agents/domain.md`, all technical proposals, PRs, and agent tasks MUST comply with accepted ADRs. Proposing changes to an accepted ADR requires opening a formal GitHub issue with justification and submitting a superseding ADR.

---

## 1. Governance & Lifecycle Statuses

- **Accepted**: Approved decision governing target implementation.
- **Superseded**: Previously accepted decision replaced by a newer ADR.
- **Rejected**: Formally considered and declined design direction.

---

## 2. ADR Master Catalog

| ADR Number & Title | Status | Date | Affected Contracts & Subsystems | Core Architectural Summary |
|---|---|---|---|---|
| [ADR 0001: Unified TypeScript Single Runtime](adr/0001-typescript-single-runtime.md) | **Accepted** | 2026-10-20 | Full Stack (`src/`, `server/`) | Replaces split Flask/Next.js stack with a unified TypeScript Node.js 24 runtime; shares Zod DTOs. |
| [ADR 0002: Persistent Node Server with Express & Socket.IO](adr/0002-persistent-next-express-socketio.md) | **Accepted** | 2026-10-20 | `server/index.ts`, `src/server/realtime/` | Custom server embeds Express 5, Socket.IO 4, and Next.js 16 in one process with in-memory DI. |
| [ADR 0003: Supabase PostgreSQL & Auth with Server Gateway](adr/0003-supabase-storage-and-auth.md) | **Accepted** | 2026-10-20 | `src/server/platform/`, `supabase/` | Supabase Auth tokens verified server-side; direct browser DB access blocked; privileged service-role backend. |
| [ADR 0004: Contract-First Four-Lane Build Architecture](adr/0004-contract-first-four-lane-build.md) | **Accepted** | 2026-10-20 | `src/contracts/`, `OWNERSHIP.md` | Work partitioned into Lanes A, B, C, D coordinated via frozen TypeScript service ports and Zod schemas. |
| [ADR 0005: Evidence-Owned Mastery Calculation Engine](adr/0005-evidence-owned-mastery.md) | **Accepted** | 2026-10-20 | `src/server/core/`, `docs/03-invariants.md` | Confidence mutated exclusively through four verifiable evidence types; 4 semantic bands; atomic RPC updates. |
| [ADR 0006: Prerequisite DAG Modeling & Bounded Syllabus Ingestion](adr/0006-prerequisite-dag-and-bounded-import.md) | **Accepted** | 2026-10-20 | `src/server/core/`, `src/server/ai/` | Strict DAG (`prerequisite -> dependent`); PDF extraction bounded to 10 pages / 40 nodes with mandatory preview. |
| [ADR 0007: Persist-Before-Publish Real-Time Delivery & Recovery](adr/0007-realtime-commit-and-recovery.md) | **Accepted** | 2026-10-20 | `src/server/realtime/`, `docs/07-realtime.md` | Database commit precedes Socket.IO broadcast; reconnection recovers state via authenticated HTTP snapshots. |
| [ADR 0008: Validated AI Pipelines with Honest Failure Modes](adr/0008-validated-ai-with-honest-failure.md) | **Accepted** | 2026-10-20 | `src/server/ai/`, `docs/08-ai-pipelines.md` | Strict Zod validation on all AI outputs; timeouts; provider outages report explicit errors without fake fallbacks. |
| [ADR 0009: Consensual Peer Collaboration & Honest Scheduling](adr/0009-consensual-peer-collaboration.md) | **Accepted** | 2026-10-20 | `src/server/study-groups/`, `src/server/zoom/` | Explicit opt-in pool; complementary gap score $\ge 0.30$; human-to-human chat; authentic Zoom OAuth meetings. |
| [ADR 0010: Explicit Fixture and Live Integration Modes](adr/0010-explicit-demo-and-live-modes.md) | **Accepted** | 2026-10-20 | `src/server/platform/`, `scripts/` | `INTEGRATION_MODE=fixture` for zero-cost offline development; `live` fails loudly when credentials missing. |
| [ADR 0011: Single-Writer Migrations & Integration Steward](adr/0011-single-writer-migrations-and-integration.md) | **Accepted** | 2026-10-20 | `supabase/migrations/`, `OWNERSHIP.md` | Lane A serves as exclusive steward for migrations, composition root, and coordination files to prevent conflicts. |
| [ADR 0012: Spark Experience Layer Over Canonical Engine](adr/0012-spark-experience-over-canonical-engine.md) | **Accepted** | 2026-10-21 | Full Stack (`src/features/`, `src/server/core/game/`) | Adopts Spark mascot, quests, encounters, tiered hints, Eclipse, XP ledger, and Class Sky over single-process TS runtime, D3-force graph, and 4-band mastery engine. |
