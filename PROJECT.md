# Project Brief: Spark

## 1. Executive Summary

Spark is an AI-augmented educational platform that connects classroom instruction with student mastery and peer collaboration. It bridges the gap between passive lecture listening and active concept retention through automated syllabus structuring, live lecture comprehension monitoring, targeted formative assessments, and intelligent peer matchmaking.

The project is an honest, production-ready TypeScript rewrite of the experimental prototype developed in the sibling `prereq` repository. It eliminates architectural drift, fragile microservice boundaries, unverified authentication fallbacks, and simulated external integrations in favor of a single unified Node.js runtime, strict domain invariants, and verified third-party integrations.

---

## 2. Strategic Technical Decisions

The system architecture is governed by twelve fundamental decisions documented in [docs/01-decisions.md](docs/01-decisions.md) and [docs/adr/](docs/adr/):

1. **Unified TypeScript Runtime ([ADR 0001](docs/adr/0001-typescript-single-runtime.md))**: Replaces the split Python Flask backend and Next.js frontend with a single Node.js runtime. All models, validations, and domain logic share identical TypeScript types and Zod schemas across the full stack.
2. **Persistent Custom Server ([ADR 0002](docs/adr/0002-persistent-next-express-socketio.md))**: Hosts Express 5, Socket.IO 4, and Next.js 16 within a single persistent Node.js process (`server/index.ts`). Sockets, HTTP handlers, and background adapters share in-memory services directly via dependency injection, eliminating the need for Redis pub/sub in single-instance deployments.
3. **Supabase PostgreSQL & Auth with Privileged Server Gateways ([ADR 0003](docs/adr/0003-supabase-storage-and-auth.md))**: Browser clients authenticate with Supabase Auth. The server verifies tokens using `auth.getUser(token)` and enforces course-level role-based access control. Direct database access from browser clients is blocked; only the backend server holds the privileged `SUPABASE_SERVICE_ROLE_KEY`.
4. **Contract-First Four-Lane Architecture ([ADR 0004](docs/adr/0004-contract-first-four-lane-build.md))**: Organizes engineering work into four decoupled lanes (A: Platform/Core, B: Classroom/Realtime, C: AI/Learning, D: Experience/UI) coordinated via frozen public contracts in `src/contracts/` and [docs/contracts/service-ports.md](docs/contracts/service-ports.md).
5. **Evidence-Owned Mastery Engine ([ADR 0005](docs/adr/0005-evidence-owned-mastery.md))**: Concept confidence is mutated exclusively through four verifiable evidence events: poll evaluations, Socratic tutoring dialogue, practice quiz submissions, and lecture attendance. Direct confidence overwrites are prohibited.
6. **Strict Prerequisite DAGs ([ADR 0006](docs/adr/0006-prerequisite-dag-and-bounded-import.md))**: Knowledge graphs are modeled as strict Directed Acyclic Graphs (edges point from prerequisite to dependent). PDF extraction is bounded to a maximum of 10 pages and 40 nodes, requiring teacher preview and confirmation before commit.
7. **Persist-Before-Publish Real-Time Delivery ([ADR 0007](docs/adr/0007-realtime-commit-and-recovery.md))**: All state changes are committed to PostgreSQL before emitting WebSocket events. Reconnecting clients recover missed events via authenticated HTTP snapshot endpoints.
8. **Validated AI with Honest Failure ([ADR 0008](docs/adr/0008-validated-ai-with-honest-failure.md))**: AI outputs from Anthropic Claude and Perplexity are parsed against strict Zod schemas with bounded timeouts. Malformed outputs or provider outages produce explicit user-facing errors rather than simulated fake grades or silent fallbacks.
9. **Consensual Peer Matchmaking ([ADR 0009](docs/adr/0009-consensual-peer-collaboration.md))**: Students match only when both have explicitly opted into the pool for overlapping concepts. Matching pairs students with complementary knowledge gaps (`score >= 0.30`), provides real in-app chat, and coordinates real Zoom meetings via OAuth.
10. **Dual-Mode Integration Architecture ([ADR 0010](docs/adr/0010-explicit-demo-and-live-modes.md))**: Supports both `INTEGRATION_MODE=fixture` (zero-cost offline testing and repeatable demos) and `INTEGRATION_MODE=live` (real Anthropic, Perplexity, and Zoom APIs). Missing live credentials fail loudly rather than silently degrading into fake data.
11. **Single-Writer Migrations & Integration ([ADR 0011](docs/adr/0011-single-writer-migrations-and-integration.md))**: Lane A serves as integration steward for database migrations, shared contracts, and configuration files, preventing merge conflicts across the four parallel streams.
12. **Spark Experience Layer Over Canonical Engine ([ADR 0012](docs/adr/0012-spark-experience-over-canonical-engine.md))**: Adopts Spark mascot, Daily Quests, streak tracking, practice encounters with 3-tier hints, Eclipse review pressure, XP effort ledger, collaborative party quests, and Class Sky instructor view over the single-process TypeScript runtime, 4-band mastery engine, and D3-force graph visualizer.

---

## 3. High-Level System Structure

The application is structured as a modular monolith:

```text
┌─────────────────────────────────────────────────────────────┐
│                 Single Node.js 24 LTS Process               │
│                                                             │
│   ┌─────────────────────┐       ┌───────────────────────┐   │
│   │   Express 5 HTTP    │       │     Socket.IO 4       │   │
│   │  (/api/* endpoints) │       │   (Real-time WSS)     │   │
│   └──────────┬──────────┘       └───────────┬───────────┘   │
│              │                              │               │
│              ▼                              ▼               │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                 Domain Core Services                │   │
│   │   - CourseService       - ClassroomService          │   │
│   │   - GraphService        - StudyGroupService         │   │
│   │   - MasteryService      - LearningService           │   │
│   │   - GameService         - EncounterService          │   │
│   └──────────┬──────────────────────────────┬───────────┘   │
│              │                              │               │
│              ▼                              ▼               │
│   ┌─────────────────────┐       ┌───────────────────────┐   │
│   │ PostgreSQL Database │       │  External Integrations│   │
│   │  (28 App Tables)    │       │  - Anthropic Claude   │   │
│   │  (Supabase Auth)    │       │  - Perplexity Search  │   │
│   │  (Transactional RPC)│       │  - Zoom RTMS / OAuth  │   │
│   └─────────────────────┘       └───────────────────────┘   │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │         Next.js 16 App Router (React 19 SSR/UI)     │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Documentation Map & Navigation

For granular specifications, consult the dedicated manuals:

| Manual | Primary Contents |
|---|---|
| [docs/00-product.md](docs/00-product.md) | User personas, product feature inventory, journeys J01–J11, Spark game loops, simulation rules |
| [docs/01-decisions.md](docs/01-decisions.md) | Index and status of ADR 0001 through ADR 0012 |
| [docs/02-architecture.md](docs/02-architecture.md) | Runtime architecture, folder layout, dependency graph, sequence flows |
| [docs/03-invariants.md](docs/03-invariants.md) | Mastery formulas, prerequisite rules, poll lifecycle, matching algorithms |
| [docs/04-build-plan.md](docs/04-build-plan.md) | Step-by-step implementation guide for all phases (P0 to P7) |
| [docs/05-data-model.md](docs/05-data-model.md) | PostgreSQL table definitions (28 tables), foreign keys, indexes, RPC stored procedures |
| [docs/06-http-api.md](docs/06-http-api.md) | REST API endpoints, DTOs, authorization rules, error envelope format |
| [docs/07-realtime.md](docs/07-realtime.md) | WebSocket events, room security, presence tracking, reconnection protocols |
| [docs/08-ai-pipelines.md](docs/08-ai-pipelines.md) | Prompt specifications, output Zod schemas, token budgets, and provider SLAs |
| [docs/09-frontend.md](docs/09-frontend.md) | Next.js routes, UI feature modules, D3-force knowledge graph, accessibility |
| [docs/10-security.md](docs/10-security.md) | Authentication verification, RBAC, Zoom webhook HMAC, encryption at rest |
| [docs/11-testing.md](docs/11-testing.md) | Testing pyramid: unit, contract, integration, and Playwright E2E suites |
| [docs/12-operations.md](docs/12-operations.md) | Developer onboarding, Docker Supabase setup, environment configuration, deploy |
| [docs/13-demo-and-acceptance.md](docs/13-demo-and-acceptance.md) | Reproducible demo scripts, seed data (33 concepts, 34 edges), validation checklists |
| [docs/14-source-audit.md](docs/14-source-audit.md) | Analysis of the sibling prototype, discrepancies resolved, and corrections made |
| [docs/contracts/service-ports.md](docs/contracts/service-ports.md) | Shared TypeScript service interfaces, parameter DTOs, and error types |
| [docs/contracts/examples.md](docs/contracts/examples.md) | Validated JSON request, response, and WebSocket event payloads |

---

## 5. Implementation Status

- [x] Technical Documentation and Architecture Suite (Current Phase)
- [x] Phase 0: Foundations & Shared Contracts (Completed)
- [ ] Phase 1: Independent Vertical Foundations (Planned)
- [ ] Phase 2: Course Setup & Prerequisite Graph (Planned)
- [ ] Phase 3: Live Classroom & Transcript Streaming (Planned)
- [ ] Phase 4: Formative Polls & Teaching Interventions (Planned)
- [ ] Phase 5: Autonomous Learning & Socratic Tutoring (Planned)
- [ ] Phase 6: Consensual Peer Collaboration & Zoom Scheduling (Planned)
- [ ] Phase 7: Deployment, Verification & Final Acceptance (Planned)
