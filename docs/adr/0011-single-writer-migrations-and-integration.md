# ADR 0011: Single-Writer Migrations & Integration Steward

## Status
Accepted

## Context
In a parallel four-lane development model, database migrations, the application composition root (`server/index.ts`), root package dependencies (`package.json`, `package-lock.json`), and master tracking files (`CHECKLIST.md`, `OWNERSHIP.md`) represent critical integration bottlenecks. If multiple developers or subagents generate database migrations concurrently or independently modify server startup wiring, merge conflicts, migration ordering collisions, and runtime initialization failures inevitably occur.

## Decision
We enforce a **Single-Writer Integration Steward** protocol:
1. **Lane A Stewardship**: Lane A (Platform & Core) acts as the exclusive integration steward for:
   - Root application composition (`server/index.ts`)
   - Shared boundary contracts (`src/contracts/*`)
   - Root configuration (`package.json`, `package-lock.json`, `tsconfig.json`)
   - Database migrations (`supabase/migrations/*`) and PostgreSQL stored procedures
   - Master project coordination documents (`CHECKLIST.md`, `OWNERSHIP.md`, `docs/01-decisions.md`)
2. **Schema Change Requests**: When Lane B (Classroom/Collaboration) or Lane C (AI/Learning) requires schema changes, new tables, or new RPC functions:
   - The requesting lane submits an exact SQL specification and TypeScript interface proposal to Lane A via a GitHub issue or integration request.
   - Lane A reviews the relational constraints, assigns the canonical migration timestamp/version, lands the migration in `supabase/migrations/`, and updates `docs/05-data-model.md`.
   - Feature lanes develop against deterministic fakes in their own test directories while awaiting migration merge.
3. **Serialized Coordination Updates**: Feature pull requests MUST NOT modify `CHECKLIST.md`. Instead, feature PRs report their stable Task ID (e.g., `P3-B-02`) and checkpoint evidence in their PR description. Lane A synchronizes the master checklist in small, serialized coordination commits following feature merges.

## Why
- Eliminates migration sequence collisions and dirty database states across developer environments.
- Protects the composition root from uncoordinated dependency injection edits.
- Maintains a clean, linear git history for schema migrations and project tracking.

## Consequences
- Requires coordination handoffs when feature lanes need new durable database columns or tables.
- Checklist updates may slightly lag feature merges until Lane A's periodic coordination updates land.
