# ADR 0001: Unified TypeScript Single Runtime

## Status
Accepted

## Context
The sibling prototype (`../prereq/`) employed a dual-language architecture: a Python Flask backend serving REST endpoints alongside a Node.js/Next.js frontend running an ephemeral Socket.IO server. This separation resulted in:
1. **Model Drift**: Duplicate data types maintained in Python (`dataclasses`/dicts) and TypeScript (`interfaces`), causing serialization mismatches and unverified payload schemas.
2. **Operational Fragility**: Two separate application processes required coordination, independent deployment pipelines, and separate runtime environments.
3. **Authentication Disconnect**: The Python backend decoded JWTs with an unverified fallback, while the Node.js frontend accepted client-asserted identity in query parameters.

## Decision
We adopt a single, unified TypeScript runtime on Node.js 24 LTS for the entire platform. Both backend services (Express 5, Socket.IO 4) and frontend views (Next.js 16, React 19) are authored exclusively in TypeScript with strict compiler settings (`"strict": true`). All domain entities, DTOs, and event payloads are defined once in `src/contracts/` using Zod 4 schemas and inferred TypeScript types.

## Why
- Eliminates serialization bugs and cross-language type drift.
- Unifies developer toolchains: a single `package.json`, single test runner (Vitest), and standard linting/typechecking.
- Allows direct in-memory service injection and sharing of domain logic (e.g., mastery formulas and DAG validations) across server and client boundaries.

## Consequences
- Requires porting Python AI orchestration (Anthropic/Perplexity calls) and PDF handling into TypeScript (using `pdf-lib`).
- Prevents independent language-level optimization (e.g., Python numeric libraries), though the domain requires only basic algebraic formulas.
- Backend and frontend must scale together within the single Node.js runtime process.
