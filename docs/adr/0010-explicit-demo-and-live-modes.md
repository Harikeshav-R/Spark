# ADR 0010: Explicit Fixture and Live Integration Modes

## Status
Accepted

## Context
Developing and testing an application dependent on multiple commercial cloud APIs (Anthropic Claude, Perplexity AI, Zoom RTMS, and Zoom OAuth) introduces developer friction, API cost, and non-deterministic test failures. Conversely, relying entirely on ad-hoc mocks risks deploying code that fails in production against real provider APIs.

## Decision
We implement a dual-mode integration architecture controlled explicitly by environment configuration:
1. **`INTEGRATION_MODE=fixture`**:
   - The application runs entirely offline using deterministic in-memory adapters and precomputed JSON fixtures.
   - All 13 AI capabilities, speech transcript streams, and Zoom meeting creations execute through deterministic TypeScript fakes without making network calls or incurring API costs.
   - Used for unit testing, contract tests, CI pipelines, local frontend design, and offline demonstrations.
2. **`INTEGRATION_MODE=live`**:
   - The application routes all external requests to authentic third-party APIs (Anthropic Claude 3.5/3.7, Perplexity Search, Zoom REST & RTMS).
   - If required provider credentials (`ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, Zoom OAuth client secrets) are missing or invalid, the system MUST NOT silently switch to fixture mode. Instead, it must fail fast during boot (`npm run doctor`) or return explicit `503 SERVICE_UNAVAILABLE` errors at the affected capability endpoints.
3. **Independent Lecture Source (`LECTURE_SOURCE=simulator|zoom`)**:
   - The transcript source is controlled independently from the AI/Zoom integration mode. In simulator mode, the system emits realistic lecture speech while exercising live AI and database layers, but MUST display a prominent `[SIMULATED TRANSCRIPT]` badge in the user interface.

## Why
- Enables zero-cost, rapid, deterministic development and end-to-end automated testing for all team members.
- Guarantees honest deployment: live production environments cannot silently mask broken API integrations with synthetic test fixtures.
- Clearly separates test artifact delivery from authentic cloud operations.

## Consequences
- Requires maintaining parallel deterministic fixture adapters in `tests/fixtures/` and service port fakes alongside production API adapters.
- Developers must configure valid provider API keys to run Phase 7 live acceptance tests.
