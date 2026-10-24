# Codebase Ownership & Four-Lane Responsibilities

This document defines the exclusive ownership boundaries, shared file stewardship, handoff protocols, and change-control procedures for Spark across four parallel engineering streams.

---

## 1. The Four Engineering Lanes

The codebase is partitioned into four independent, vertical engineering lanes:

| Lane | Developer Lead | Domain Focus | Exclusive Source Paths | Owned Capabilities |
|---|---|---|---|---|
| **Lane A** | **Hari** | **Platform & Core** | `src/server/platform/`<br>`src/server/core/`<br>`supabase/migrations/`<br>`scripts/` | Auth token verification, RBAC middleware, database migrations, RPCs, course lifecycle, enrollment, core knowledge graph, evidence-owned mastery engine, and game progression storage (`src/server/core/game/`: Daily Quests, streak evaluation, XP ledger, Eclipse review pressure, teacher effort aggregates). Integration steward for root composition. |
| **Lane B** | **Rahul** | **Classroom & Collaboration** | `src/server/classroom/`<br>`src/server/realtime/`<br>`src/server/zoom/`<br>`src/server/study-groups/` | Live lecture sessions, transcript ingestion, presence tracking, formative polls, Zoom RTMS/OAuth, peer matching, candidate invitations, peer chat, mutual availability scheduling, and collaborative party quests. |
| **Lane C** | **Praj** | **AI & Autonomous Learning** | `src/server/ai/`<br>`src/server/learning/`<br>`src/features/tutor/`<br>`src/features/learning/`<br>`src/features/study-groups/`<br>`src/features/encounters/` | Anthropic and Perplexity prompt pipelines, Socratic tutoring, learning pages, quizzes, academic search, practice encounters with tiered hints (`src/server/learning/encounter-service.ts`), and autonomous feature UI components (`TutorFeature`, `LearningFeature`, `StudyGroupFeature`, `EncounterFeature`). |
| **Lane D** | **Vamshi** | **Core Experience & UI** | `src/features/auth/`<br>`src/features/courses/`<br>`src/features/professor/`<br>`src/features/student/`<br>`src/features/graph/`<br>`src/features/mascot/`<br>`src/components/ui/`<br>`src/lib/client/`<br>`src/app/` | Global layout shells, Next.js page routes, D3-force knowledge graph visualizer with dynamic star vessels, warm palette design tokens, SVG companion mascot Spark, teacher Class Sky and effort roster quadrant, lecture controls, and client transport libraries. UI integration steward. |

---

## 2. Test Suite Ownership

To prevent test-file merge conflicts during concurrent branch development, test directories are strictly partitioned by lane:
- **Unit Tests**: `tests/unit/lane-a/`, `tests/unit/lane-b/`, `tests/unit/lane-c/`, `tests/unit/lane-d/`
- **Contract Tests**: `tests/contracts/lane-a/`, `tests/contracts/lane-b/`, `tests/contracts/lane-c/`, `tests/contracts/lane-d/`
- **Integration Tests**: `tests/integration/lane-a/`, `tests/integration/lane-b/`, `tests/integration/lane-c/`
- **End-to-End Tests**: Cross-lane Playwright journeys in `tests/e2e/` have a designated primary owner (Lane D owns UI journeys J01–J06 and J09–J11; Lane B owns J07 peer journey; Lane A owns J08 deploy journey).

---

## 3. Shared File Integration Stewards

Shared root files and composition boundaries are managed by designated stewards:

### 3.1 Lane A Stewardship (Hari)
- **Composition Root**: `server/index.ts` (wires services and mounts routers).
- **Public Boundary Contracts**: `src/contracts/*` (shared Zod DTOs, events, and service interfaces).
- **Package & Toolchain Config**: `package.json`, `package-lock.json`, `tsconfig.json`.
- **Database Migrations**: `supabase/migrations/*`.
- **Project Governance**: `CHECKLIST.md`, `OWNERSHIP.md`, `docs/01-decisions.md`.

*Rule: Lane B and Lane C developers DO NOT directly edit `supabase/migrations/` or `server/index.ts`. When a new table or startup injection is needed, the lane opens a Schema Change Request (SCR) with the proposed SQL/interface, which Lane A reviews and merges.*

### 3.2 Lane D Stewardship (Vamshi)
- **Shared UI Tokens**: `src/components/ui/*` (Button, Modal, Card, Input primitives).
- **Global Theme & Layout**: `src/app/layout.tsx`.
- **Client Transport Layer**: `src/lib/client/http.ts`, `src/lib/client/socket.ts`.

*Rule: Lane C exports self-contained feature views (`TutorFeature`, `StudyGroupFeature`, `LearningFeature`, `EncounterFeature`). Lane C NEVER modifies `src/app/*` route shells. Lane D mounts Lane C's exported features inside page wrappers.*

---

## 4. Work Claiming & Coordination Protocol

1. **Issue-Driven Claims**: Tasks are identified by stable checklist IDs (e.g., `P3-B-02`). Developers claim work by assigning the corresponding GitHub issue.
2. **Checklist Immutability in Feature PRs**: Feature PRs MUST NOT edit `CHECKLIST.md`. The PR description must reference the task ID and provide verifiable checkpoint command output.
3. **Serialized Coordination Merges**: Lane A synchronizes `CHECKLIST.md` in small, dedicated coordination commits after verifying feature PR merges.
4. **Contract Change Control**: Modifying any schema in `src/contracts/` requires:
   - Opening an issue labeled `contract-change`.
   - Approval from all producer and consumer lanes.
   - Updating contract fixtures in `docs/contracts/examples.md`.
   - Coordinated atomic PR cutover.
