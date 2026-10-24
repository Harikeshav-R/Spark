# HackOHIO Classroom Companion

A TypeScript-only, real-time classroom intelligence and peer-learning platform. The platform ingests course syllabi into prerequisite knowledge graphs, streams live lecture transcripts, detects discussed concepts in real time, generates Socratic polls with server-side evaluation, updates individual student mastery models, and coordinates consensual peer study groups with genuine Zoom meeting scheduling.

> **Current Repository Status: Documentation-Only**  
> This repository currently contains the authoritative engineering specification, architecture decision records, data models, API contracts, execution checklist, and four-developer ownership plan. No application code, dependencies, or database migrations are deployed yet. Application paths and scripts referenced throughout the documentation define the future implementation contract.

---

## 1. Product Summary

HackOHIO Classroom Companion is an independent, production-grade TypeScript recreation and enhancement of the sibling `prereq` prototype. It replaces a split Flask/Next.js prototype with a single unified Node.js runtime, honest third-party integrations, and rigorous invariant enforcement.

### Core Capabilities

- **Prerequisite Knowledge Graph**: Extracts a directed acyclic graph (DAG) of 30–40 core course concepts from uploaded PDF syllabi (up to 10 processed pages) using Anthropic Claude, validated for acyclicity and foundational prerequisites.
- **Real-Time Lecture Streaming**: Streams live lecture speech via Zoom Real-Time Media Streams (RTMS) or an automated lecture simulator, ingesting transcript chunks and detecting covered concepts on the fly.
- **Socratic Formative Assessment**: Generates open-ended poll questions aligned with active lecture concepts. The server grades student free-form responses against rubric criteria and updates student mastery atomically.
- **Evidence-Based Mastery Engine**: Maintains personal concept confidence across four semantic bands (`gray`, `red`, `yellow`, `green`) driven exclusively by verifiable evidence: poll evaluations, Socratic tutoring dialogue, practice quiz submissions, and lecture attendance.
- **Targeted Teacher Interventions**: Analyzes live aggregate student comprehension and misconceptions to suggest actionable, course-specific teaching adjustments during class.
- **Autonomous Student Learning**: Generates comprehensive concept learning pages, server-graded practice quizzes, Socratic tutoring conversations, and cited web resources via Perplexity.
- **Consensual Peer Collaboration**: Matches enrolled students who explicitly opt into a study pool based on complementary knowledge gaps. Facilitates real in-app messaging, mutual availability overlap scheduling, and authentic Zoom meeting creation.

---

## 2. Reading Routes

Depending on your role and immediate objective, consult the following documentation pathways:

### For Engineering Leads & Architects
1. [PROJECT.md](PROJECT.md) — Executive product and technical brief.
2. [docs/02-architecture.md](docs/02-architecture.md) — Unified TypeScript runtime, server composition, and state boundaries.
3. [docs/01-decisions.md](docs/01-decisions.md) & [docs/adr/](docs/adr/) — Accepted Architecture Decision Records (ADR 0001–0011).
4. [docs/03-invariants.md](docs/03-invariants.md) — Mathematical formulas, state machine invariants, and failure counterexamples.
5. [docs/14-source-audit.md](docs/14-source-audit.md) — Audit of the sibling prototype, discrepancies resolved, and deliberate corrections.

### For Implementers & Subagents
1. [AGENTS.md](AGENTS.md) — Operational instructions, workflow gates, escalation policies, and definitions of done.
2. [OWNERSHIP.md](OWNERSHIP.md) — Four-lane task ownership (Lanes A, B, C, D), file boundaries, and integration steward rules.
3. [CHECKLIST.md](CHECKLIST.md) — Master task tracking matrix from Phase 0 to Phase 7 with stable task IDs.
4. [docs/04-build-plan.md](docs/04-build-plan.md) — Detailed implementation steps and verifiable checkpoints for each checklist task.
5. [docs/contracts/service-ports.md](docs/contracts/service-ports.md) & [docs/contracts/examples.md](docs/contracts/examples.md) — Frozen TypeScript service interfaces and JSON fixtures.

### For Domain & Feature Developers
- **Data & Storage**: [docs/05-data-model.md](docs/05-data-model.md) (22 application tables, constraints, RPCs).
- **HTTP API**: [docs/06-http-api.md](docs/06-http-api.md) (REST endpoints, auth policies, error envelopes).
- **Real-Time WebSockets**: [docs/07-realtime.md](docs/07-realtime.md) (Socket.IO events, room isolation, attendance tracking).
- **AI Pipelines**: [docs/08-ai-pipelines.md](docs/08-ai-pipelines.md) (Claude and Perplexity prompts, schemas, budgets, and timeouts).
- **Frontend Architecture**: [docs/09-frontend.md](docs/09-frontend.md) (Next.js App Router, feature modules, D3-force graph, a11y).
- **Security & Secrets**: [docs/10-security.md](docs/10-security.md) (Auth verification, RBAC, Zoom webhook HMAC, encryption at rest).
- **Quality Assurance**: [docs/11-testing.md](docs/11-testing.md) (Unit, contract, integration, and Playwright E2E suites).
- **Operations & Runbooks**: [docs/12-operations.md](docs/12-operations.md) (Local setup, Docker Supabase, migrations, deployment).
- **Demonstration & Acceptance**: [docs/13-demo-and-acceptance.md](docs/13-demo-and-acceptance.md) (Seeded demo scenarios, J01–J08 acceptance criteria).

---

## 3. Future Quickstart Prerequisites

When implementation begins in Phase 0, the project will require the following toolchains and services:

- **Node.js**: `24.x` (LTS)
- **Package Manager**: `npm` (with committed `package-lock.json`)
- **Docker**: Engine `26+` (for running local Supabase CLI containers)
- **Supabase CLI**: `v1.170+` (local PostgreSQL database, migrations, and Auth engine)
- **External Accounts (for Live Integration Mode)**:
  - Anthropic API key (`ANTHROPIC_API_KEY`)
  - Perplexity API key (`PERPLEXITY_API_KEY`)
  - Zoom Marketplace App credentials (OAuth 2.0 Client ID, Secret, Secret Token)

*Note: In `INTEGRATION_MODE=fixture`, the application runs completely offline using deterministic test fixtures without external API keys or cloud dependencies.*

---

## 4. Repository Navigation

```text
.
├── AGENTS.md                  # Autonomous agent workflow rules and gates
├── CHECKLIST.md               # Master implementation checklist (P0-A-01 through P7-D-03)
├── GLOSSARY.md                # Standardized domain terminology
├── LICENSE                    # Repository license
├── OWNERSHIP.md               # Four-lane responsibility matrix and steward policies
├── PROJECT.md                 # Product and architectural overview
├── README.md                  # This file
├── docs/                      # Canonical technical documentation suite
│   ├── README.md              # Documentation index and hierarchy
│   ├── 00-product.md          # Personas, feature inventory, user journeys J01–J08
│   ├── 01-decisions.md        # Architecture Decision Records index
│   ├── 02-architecture.md     # Runtime design, module structure, sequence diagrams
│   ├── 03-invariants.md       # Formal domain invariants and mathematical rules
│   ├── 04-build-plan.md       # Step-by-step instructions for all checklist tasks
│   ├── 05-data-model.md       # Database schemas, relational constraints, RPC functions
│   ├── 06-http-api.md         # Canonical Express HTTP REST contracts
│   ├── 07-realtime.md         # Socket.IO event specifications and room protocols
│   ├── 08-ai-pipelines.md     # Anthropic and Perplexity prompt pipelines and schemas
│   ├── 09-frontend.md         # Next.js App Router, React 19 UI, and graph visualizer
│   ├── 10-security.md         # RBAC, token verification, credential encryption, privacy
│   ├── 11-testing.md          # Testing strategy, fixture policies, regression suites
│   ├── 12-operations.md       # Bootstrapping, configuration, migrations, host deployment
│   ├── 13-demo-and-acceptance.md # Seed data specification and journey acceptance tests
│   ├── 14-source-audit.md     # Provenance audit and discrepancy resolution record
│   ├── adr/                   # Accepted Architecture Decision Records (0001–0011)
│   ├── agents/                # Repo issue tracker and triage documentation
│   └── contracts/             # Shared TypeScript service ports and JSON fixtures
```
