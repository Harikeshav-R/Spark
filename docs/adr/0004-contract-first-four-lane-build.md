# ADR 0004: Contract-First Four-Lane Build Architecture

## Status
Accepted

## Context
Developing a full educational platform across database models, real-time streaming, AI pipelines, and interactive UI with four developers (or autonomous subagents) introduces high risk of integration conflicts, divergent data formats, and blocking dependencies. Without strict boundaries, developers frequently edit shared files concurrently, causing churn and merge collisions.

## Decision
We organize the engineering implementation into four decoupled, vertical lanes:
- **Lane A (Platform & Core)**: Database schema, migrations, authentication, course enrollment, core knowledge graph, and mastery engine.
- **Lane B (Classroom & Collaboration)**: Live lecture lifecycle, transcript ingestion, real-time presence, polls, Zoom integration, and study group matchmaking.
- **Lane C (AI & Autonomous Learning)**: Anthropic and Perplexity prompt pipelines, Socratic tutoring, learning pages, quizzes, and learning UI modules.
- **Lane D (Core Experience & UI)**: Shared design tokens, Next.js page shells, teacher and student lecture dashboards, and D3-force knowledge graph.

All inter-lane communication is governed by frozen TypeScript service interfaces and Zod DTO contracts defined upfront in Phase 0 (`src/contracts/` and `docs/contracts/service-ports.md`). Each lane develops and tests its features in isolation using deterministic fakes of other lanes' services. Lane A acts as the integration steward for shared configuration, migration, and composition files.

## Why
- Eliminates blocked progress: Lane B or C can build complex features against deterministic fakes while Lane A finalizes physical database migrations.
- Minimizes file collisions: Each lane owns exclusive source directories.
- Provides absolute clarity on system boundaries and contract stability.

## Consequences
- Requires upfront architectural discipline to freeze service ports and schemas in Phase 0 before feature coding begins.
- Modifying a public contract requires opening an issue, notifying affected consumer lanes, and conducting a coordinated cutover.
