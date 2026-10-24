# Autonomous Agent Operational Guide: HackOHIO-2026

This document is the authoritative operational manual for autonomous AI coding agents operating in this repository.

---

## 1. Orientation & Required Reading

Before reading files or making changes, every agent MUST consult:
1. **[CHECKLIST.md](CHECKLIST.md)**: Find your lane's current dependency-ready task.
2. **[OWNERSHIP.md](OWNERSHIP.md)**: Verify that the files you intend to touch belong exclusively to your lane.
3. **[docs/04-build-plan.md](docs/04-build-plan.md)**: Read the exact instructions and checkpoint commands for your assigned task ID.
4. **[docs/contracts/service-ports.md](docs/contracts/service-ports.md)**: Review frozen public TypeScript interfaces before writing implementation code.
5. **[docs/03-invariants.md](docs/03-invariants.md)**: Review domain invariants and mathematical formulas affecting your task.

---

## 2. Current Repository State

> **CRITICAL**: The repository is currently in **Phase 0 Documentation-Only Status**.  
> No application code, dependencies, or migrations are yet deployed in `src/`, `supabase/`, or `server/`. Application paths, npm commands, and test suites referenced in documentation describe the target contract. Agents MUST NOT assume proposed files exist or claim future checkpoints have passed until their respective tasks are actually implemented.

---

## 3. Hard Architectural Gates

Autonomous agents MUST NEVER violate these inviolable engineering gates:
- **GATE 1 (Identity & Auth)**: NEVER trust client-supplied user IDs, student IDs, or role claims. All identity MUST be derived on the server from verified Supabase JWTs via `auth.getUser(token)`.
- **GATE 2 (Course Authorization)**: NEVER execute a database query or mutation with the service-role client without verifying that the authenticated user owns or is enrolled in the target course.
- **GATE 3 (Single Mastery Writer)**: Direct SQL updates to `student_mastery` from UI, sockets, or AI modules are STRICTLY PROHIBITED. All confidence updates MUST route through `MasteryService.applyEvidence()`.
- **GATE 4 (Strict DAG Invariant)**: Knowledge graphs MUST remain acyclic, strictly directed from prerequisite to dependent, with between 1 and 40 nodes.
- **GATE 5 (Persist Before Broadcast)**: NEVER emit a WebSocket event before the underlying data mutation is successfully committed to PostgreSQL.
- **GATE 6 (No Fake Live Integrations)**: When `INTEGRATION_MODE=live` is configured, NEVER fabricate responses or fallback to fixtures if external credentials (Anthropic, Perplexity, Zoom) are missing. Missing credentials MUST return explicit `503 SERVICE_UNAVAILABLE`.
- **GATE 7 (Zero Secret Exposure)**: NEVER check secrets, API keys, or plaintext Zoom OAuth credentials into git or expose them over browser HTTP responses.
- **GATE 8 (Branch Isolation & Zero Direct Main Commits)**: NEVER commit directly to `main`. ALWAYS create a dedicated feature branch using conventional branch naming before making code changes. ALWAYS open a Pull Request upon task completion. NEVER auto-merge PRs to `main`; all merges require human review.
---

## 4. Agent Execution Workflow

Follow this seven-step sequence for every assigned task:
1. **Check Dependency Frontier**: Locate the earliest unblocked, dependency-ready task in your lane within [CHECKLIST.md](CHECKLIST.md).
2. **Review Task Specification**: Read the exact build instructions in [docs/04-build-plan.md](docs/04-build-plan.md).
3. **Create Conventional Branch**: NEVER work on `main`. Create and checkout an isolated branch (e.g., `feat/lane-b-p3-b-02-transcript-ingestion` or `lane-b/p3-b-02-transcript-ingestion`) off fresh `main`.
4. **Implement Against Contracts**: Write code strictly within your lane's exclusive file paths (see [OWNERSHIP.md](OWNERSHIP.md)). Adhere strictly to types in `src/contracts/`.
5. **Run Verification Command**: Execute the task's designated checkpoint command (e.g., `npm run test:contracts` or task-specific test suite).
6. **Inspect Verification Output**: Verify that assertions pass completely with zero mocked shortcuts.
7. **Open Pull Request & Report Evidence**: Commit using Conventional Commits, push the branch, and open a PR via `gh pr create` with task ID, changes summary, and verbatim test output. NEVER auto-merge to `main`. Do not edit `CHECKLIST.md` directly; Lane A synchronizes the master checklist after human merge.
---

## 5. Architectural Boundaries & Import Restrictions

- **Public Exports Only**: When consuming services from another domain (e.g., Lane B calling Lane A's `MasteryService`), import ONLY from the domain's public index file (`src/server/core/index.ts`) or `src/contracts/`. NEVER import internal private files across domain boundaries.
- **No Client DB Queries**: Code under `src/features/`, `src/components/`, `src/lib/client/`, or `src/app/` MUST NOT import database repositories, SQL query builders, or `@supabase/supabase-js` service clients.
- **Single Runtime**: All server routes belong to Express under `/api/*`. Next.js serves pages under `src/app/`. Do not create route handlers under `src/app/api/`.

---

## 6. TypeScript, React & Database Standards

- **TypeScript Strictness**: `"strict": true` is enforced. Never use `any`—use `unknown` and validate with Zod schemas at system boundaries.
- **Error Handling**: Never catch and swallow errors with empty `catch {}` blocks. Always catch typed errors, log contextual diagnostic data, and propagate standard `ApiError` responses.
- **Finite Numbers**: Confidence values must be verified finite numbers in $[0.0, 1.0]$. `NaN` and `Infinity` are rejected.
- **React Standards**: Prefer Server Components for layout shells; use Client Components (`"use client"`) only for interactive widgets, real-time listeners, and canvas state. Render AI content only after HTML sanitization.

---

## 7. Testing & Verifiable Evidence Requirements

- **Evidence-First**: Never claim a task or bug fix is complete without executing the specific test command.
- **No Mock Echoes**: Tests must assert real behavioral transitions, boundary invariants, and error cases, not trivial tautologies or echo assertions.
- **Offline Determinism**: All unit and contract test suites MUST execute entirely offline in `INTEGRATION_MODE=fixture` without requiring live cloud credentials.

---

## 8. Four-Person Ownership & Lane Boundaries

Refer to [OWNERSHIP.md](OWNERSHIP.md) for full lane mappings:
- **Lane A**: Platform, core database schema, migrations, auth verification, course lifecycle, knowledge graph, and mastery engine.
- **Lane B**: Live lectures, transcript ingestion, real-time presence, formative polls, Zoom RTMS/OAuth, and peer collaboration.
- **Lane C**: AI prompt pipelines, Socratic tutoring, learning guides, quizzes, academic search, and autonomous feature UI.
- **Lane D**: Page shells, navigation, D3-force knowledge graph visualizer, lecture dashboards, and shared UI tokens.

---

## 9. Git, Branching & Pull Request Rules

- **Always Branch, Never Commit on Main**: Direct commits to `main` are strictly prohibited. Every unit of work MUST occur in a dedicated, isolated branch created from the latest `origin/main`.
- **Conventional Branches**: Branch names MUST follow standard prefix conventions:
  - `<type>/<lane>-<task-id>-<short-kebab-description>` (e.g., `feat/lane-b-p3-b-02-transcript-ingestion`, `fix/lane-a-p1-a-01-jwt-parsing`)
  - Or `<lane>/<task-id>-<short-kebab-description>` (e.g., `lane-c/p4-c-02-poll-evaluation`).
  - Valid types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- **Conventional Commits**: Every commit message MUST follow the Conventional Commits 1.0.0 specification:
  - Format: `<type>(<scope>): <imperative summary>` (e.g., `feat(classroom): add transcript chunk ingestion endpoint`).
  - Valid types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `perf`.
  - Imperative mood, lowercase, no trailing period.
- **Always Open PRs After Completion**: Upon completing implementation and verifying that all checkpoints and test suites pass, agents MUST push the branch to the remote and open a GitHub Pull Request using `gh pr create`.
  - Scope each PR strictly to a single checklist task ID.
  - The PR body must include: Task ID, summary of changes, touched files, and verbatim verification output.
- **Never Auto-Merge to Main**: Autonomous agents MUST NEVER merge pull requests to `main`, enable GitHub auto-merge, or execute manual fast-forward/squash merges onto `main`. All PR merges require human code review and signoff.
- **No Force Pushing**: Destructive git commands (`git push --force`, `git push -f`, `git reset --hard`) against shared or remote branches are strictly prohibited.

## 10. Escalation Protocols

Halt and escalate immediately to the human lead when encountering:
1. **Contract Contradiction**: A conflict between an ADR in `docs/adr/` and a service port in `docs/contracts/service-ports.md`.
2. **Schema Change Requirement**: A feature requires altering database columns or adding an RPC. (Submit SCR to Lane A).
3. **Third-Party Provider Outage**: Persistent failure of live Anthropic or Zoom endpoints during Phase 7 live verification.

---

## 11. Preserved Integration Context & Agent Skills

### Issue Tracker Integration
Issues and specs live in GitHub Issues for `Harikeshav-R/HackOHIO-2026`. See **[docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)**. Use the `gh` CLI for issue creation, wayfinding queries, and task claiming.

### Canonical Triage Labels
The five canonical triage labels are: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See **[docs/agents/triage-labels.md](docs/agents/triage-labels.md)**.

### Domain Documentation Guidelines
This is a single-context repository utilizing **[GLOSSARY.md](GLOSSARY.md)** at the root and **[docs/adr/](docs/adr/)** for architectural decisions. Before exploring domain concepts, consult **[docs/agents/domain.md](docs/agents/domain.md)**. Always use vocabulary defined in `GLOSSARY.md` and avoid terms explicitly flagged under `_Avoid_`.

---

## 12. Definition of Done (DoD) Checklist

A task is complete only when all criteria are satisfied:
- [ ] Code is authored strictly within the lane's owned file paths.
- [ ] TypeScript compiles cleanly with zero errors (`npm run typecheck`).
- [ ] ESLint passes with zero warnings (`npm run lint`).
- [ ] Task-specific unit, contract, or integration tests pass completely.
- [ ] Checkpoint command output is captured and verified.
- [ ] Public service contracts remain unchanged or have an approved SCR.
- [ ] No secrets or unverified fallback logic introduced.
