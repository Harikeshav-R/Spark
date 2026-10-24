# Technical Documentation Suite

Welcome to the technical documentation suite for Spark. This suite provides the complete architectural, mathematical, behavioral, and operational specifications for the TypeScript recreation.

---

## 1. Documentation Authority Hierarchy

When resolving apparent contradictions between project documents or implementations, follow this strict precedence hierarchy:

```text
Level 1: Highest Authority
  ├── docs/03-invariants.md       (Mathematical rules, mastery formulas, state machines, game progression invariants)
  ├── docs/01-decisions.md        (Accepted ADRs 0001–0012 under docs/adr/)
  └── docs/contracts/service-ports.md (Canonical TypeScript interface signatures)

Level 2: Structural & Domain Models
  ├── docs/05-data-model.md       (PostgreSQL tables, indexes, constraints, RPCs)
  ├── docs/06-http-api.md         (HTTP endpoints, request/response DTOs, status codes)
  ├── docs/07-realtime.md         (WebSocket events, room definitions, payload schemas)
  └── docs/08-ai-pipelines.md     (Prompt structures, output Zod schemas, timeouts)

Level 3: Feature Specifications & Workflows
  ├── docs/00-product.md          (Personas, features, J01–J11 acceptance criteria, Spark experience)
  ├── docs/02-architecture.md     (Process runtime, dependency graphs, sequence diagrams)
  ├── docs/09-frontend.md         (Page shells, UI components, client state)
  ├── docs/10-security.md         (RBAC matrix, token validation, secret handling)
  ├── docs/11-testing.md          (Test layers, fixture policies, regression suites)
  ├── docs/12-operations.md       (Bootstrap, environment, Docker, deployment)
  └── docs/13-demo-and-acceptance.md (Seed fixture data, manual test scripts)

Level 4: Execution & Historical Record
  ├── OWNERSHIP.md                (Lane assignments, path ownership, steward rules)
  ├── CHECKLIST.md                (Master task completion matrix)
  ├── docs/04-build-plan.md       (Step-by-step task instructions and checkpoints)
  └── docs/14-source-audit.md     (Prototype discrepancy resolution and provenance)
```

*Rule: If an implementation task or UI component proposes an API signature that conflicts with `docs/contracts/service-ports.md` or a formula that conflicts with `docs/03-invariants.md`, Level 1 authority prevails. Changing Level 1 documents requires an issue proposal and cross-lane review.*

---

## 2. Document Catalog

| File | Title | Primary Responsibility |
|---|---|---|
| [00-product.md](00-product.md) | Product Specification | Target personas, comprehensive feature inventory, user journeys J01–J11, Spark game loops, explicit simulation rules. |
| [01-decisions.md](01-decisions.md) | Architecture Decisions Index | Status and brief summary of ADR 0001 through ADR 0012. |
| [02-architecture.md](02-architecture.md) | System Architecture | Single-runtime design, server composition, folder structure, game progression flows, sequence diagrams. |
| [03-invariants.md](03-invariants.md) | Formal System Invariants | Exact mathematical mastery formulas, prerequisite DAG rules, poll states, peer match scoring, game progression invariants. |
| [04-build-plan.md](04-build-plan.md) | Detailed Build Plan | Step-by-step instructions and verifiable checkpoints for all tasks P0-A-01 through P7-D-04. |
| [05-data-model.md](05-data-model.md) | Data Model & Relational Schema | 28 PostgreSQL application tables, foreign keys, indexes, transactional RPC functions. |
| [06-http-api.md](06-http-api.md) | HTTP REST API Contracts | Express 5 routes, DTOs, authentication requirements, status codes, standard error envelope. |
| [07-realtime.md](07-realtime.md) | Real-Time WebSocket Protocols | Socket.IO 4 events, room authorization, reference-counted attendance tracking, reconnect sync. |
| [08-ai-pipelines.md](08-ai-pipelines.md) | AI Pipelines & Prompt Contracts | 13 AI capabilities across Anthropic and Perplexity, prompts, Zod schemas, SLAs, and fallbacks. |
| [09-frontend.md](09-frontend.md) | Frontend & Client Architecture | Next.js App Router shells, feature components, D3-force knowledge graph, accessibility. |
| [10-security.md](10-security.md) | Security, Identity & Privacy | Supabase Auth token validation, RBAC matrix, Zoom webhook HMAC, credential encryption at rest. |
| [11-testing.md](11-testing.md) | Testing Strategy & Assurance | Unit, contract, integration, and Playwright E2E suites; offline fixture policies. |
| [12-operations.md](12-operations.md) | Operations & Deployment | Local developer setup, Docker Supabase, migrations, persistent host configuration (Render). |
| [13-demo-and-acceptance.md](13-demo-and-acceptance.md) | Seed Data & Acceptance Protocols | Canonical 33-concept / 34-edge seed graph, 4 student profiles, acceptance test runbooks J01–J11. |
| [14-source-audit.md](14-source-audit.md) | Reference Audit & Discrepancies | Analysis of sibling prototype, resolved inconsistencies, and deliberate engineering corrections. |
| [contracts/service-ports.md](contracts/service-ports.md) | Canonical Service Ports | TypeScript interfaces for all domain services, repositories, and third-party adapters. |
| [contracts/examples.md](contracts/examples.md) | Shared JSON Fixtures | Concrete JSON examples for all request, response, and event payloads referenced by manuals. |

---

## 3. Role-Based Reading Paths

### Backend & Platform Engineer (Lane A)
- Start with [docs/02-architecture.md](02-architecture.md) and [docs/adr/0001-typescript-single-runtime.md](adr/0001-typescript-single-runtime.md).
- Master the data layer: [docs/05-data-model.md](05-data-model.md) and [docs/03-invariants.md](03-invariants.md).
- Implement platform contracts: [docs/06-http-api.md](06-http-api.md) (Auth/Course/Game progression endpoints) and [docs/contracts/service-ports.md](contracts/service-ports.md).
- Implement game progression: [docs/03-invariants.md](03-invariants.md) (Daily Quests, streaks, XP ledger, Eclipse).
- Review operational setup: [docs/12-operations.md](12-operations.md) and [OWNERSHIP.md](../OWNERSHIP.md).

### Realtime & Collaboration Engineer (Lane B)
- Master real-time delivery: [docs/07-realtime.md](07-realtime.md) and [docs/adr/0007-realtime-commit-and-recovery.md](adr/0007-realtime-commit-and-recovery.md).
- Study classroom and peer domain rules: [docs/03-invariants.md](03-invariants.md) (Polls and Matching).
- Implement classroom & study group endpoints: [docs/06-http-api.md](06-http-api.md) (Lectures, Polls, Zoom, Study Groups, Party Quests).
- Understand third-party boundaries: [docs/10-security.md](10-security.md) (Zoom OAuth/Webhooks) and [docs/contracts/service-ports.md](contracts/service-ports.md) (`ClassroomService`, `ZoomAdapter`, `StudyGroupService`).

### AI & Autonomous Learning Engineer (Lane C)
- Master AI capabilities: [docs/08-ai-pipelines.md](08-ai-pipelines.md) and [docs/adr/0008-validated-ai-with-honest-failure.md](adr/0008-validated-ai-with-honest-failure.md).
- Study mastery mutation rules: [docs/03-invariants.md](03-invariants.md) (Tutor and Quiz evidence).
- Implement learning endpoints & UI: [docs/06-http-api.md](06-http-api.md) (Tutoring, Learning Pages, Quizzes, Encounters, Hints, Resources) and [docs/09-frontend.md](09-frontend.md) (`TutorFeature`, `LearningFeature`, `EncounterFeature`, `StudyGroupFeature`).
- Review contract fixtures: [docs/contracts/service-ports.md](contracts/service-ports.md) (`AiService`, `LearningService`, `EncounterService`) and [docs/contracts/examples.md](contracts/examples.md).

### Experience & Frontend Engineer (Lane D)
- Master UI architecture: [docs/09-frontend.md](09-frontend.md) and [docs/00-product.md](00-product.md) (Warm design tokens, Spark mascot, Star visualizer, Class Sky).
- Study knowledge graph visualizer: [docs/09-frontend.md#knowledge-graph-visualization](09-frontend.md) and [docs/03-invariants.md](03-invariants.md) (Layout and prerequisite levels).
- Mount route shells and client transports: [docs/06-http-api.md](06-http-api.md), [docs/07-realtime.md](07-realtime.md), and [OWNERSHIP.md](../OWNERSHIP.md).
- Verify end-to-end user journeys: [docs/13-demo-and-acceptance.md](13-demo-and-acceptance.md) and [docs/11-testing.md](11-testing.md) (Playwright E2E J01–J11).
