# Contributing to Spark

Thank you for contributing to the Spark repository.

Please follow these operational rules, standards, and engineering gates.

---

## 1. Architecture & Lane Ownership

The codebase is split into four vertical engineering lanes to enable conflict-free parallel work:
- **Lane A (Hari)**: Platform, core database migrations, auth verification, course lifecycle, knowledge graph, mastery engine.
- **Lane B (Rahul)**: Classroom sessions, transcript ingestion, presence, polls, Zoom integration, study groups.
- **Lane C (Praj)**: AI prompt pipelines, Socratic tutoring, learning guides, quizzes, academic search.
- **Lane D (Vamshi)**: UI layout shells, Next.js routes, D3-force knowledge graph visualizer, design tokens, client transport.

Before touching files, check [OWNERSHIP.md](OWNERSHIP.md) to ensure files are within your lane's exclusive paths.

---

## 2. Hard Architectural Gates

All contributions must strictly respect the repository gates defined in [AGENTS.md](AGENTS.md):
- **GATE 1 (Identity & Auth)**: Server derives identity from verified Supabase JWTs. Never trust client-supplied user IDs.
- **GATE 2 (Course Authorization)**: Verify user course ownership or enrollment on every service-role query.
- **GATE 3 (Single Mastery Writer)**: All confidence updates must route through `MasteryService.applyEvidence()`.
- **GATE 4 (Strict DAG Invariant)**: Knowledge graphs must remain acyclic (1 to 40 nodes).
- **GATE 5 (Persist Before Broadcast)**: Commit state to PostgreSQL before emitting WebSocket events.
- **GATE 6 (No Fake Live Integrations)**: When `INTEGRATION_MODE=live`, missing credentials must return `503 SERVICE_UNAVAILABLE`.
- **GATE 7 (Zero Secret Exposure)**: Never commit secrets or API keys.
- **GATE 8 (Branch Isolation & Zero Direct Main Commits)**: Never commit directly to `main`. Always branch off fresh `origin/main` and open a pull request.

---

## 3. Branching & Git Workflow

1. **Pull Latest Main**:
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create Conventional Branch**:
   Direct commits to `main` are strictly prohibited. Create an isolated feature branch:
   - `<type>/<lane>-<task-id>-<short-description>` (e.g., `feat/lane-b-p3-b-02-transcript-ingestion`)
   - `<type>/<short-description>` (e.g., `chore/github-repo-best-practices`)
   - Valid types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

3. **Conventional Commits**:
   Format: `<type>(<scope>): <imperative summary>`
   - `feat(classroom): add transcript chunk ingestion endpoint`
   - `fix(auth): validate jwt expiry correctly`
   - `test(mastery): assert acyclic graph propagation bounds`

---

## 4. Local Development & Verification

Ensure you are using **Node.js 24** (or Node 22+).

Run the local verification suite:
```bash
# Typecheck
npm run typecheck

# Lint
npm run lint

# Run all unit and integration tests
npm test

# Run shared contract tests
npm run test:contracts

# Complete verification checkpoint
npm run check
```

### Offline Determinism
All test suites must execute offline without live external cloud credentials (`INTEGRATION_MODE=fixture`).

---

## 5. Pull Requests & Definition of Done

When work is complete:
1. Push branch to `origin`:
   ```bash
   git push -u origin <branch-name>
   ```
2. Open a Pull Request using `gh pr create` or the GitHub UI.
3. Fill out the PR template completely:
   - Reference the Task ID / Issue number.
   - Summarize changes.
   - Paste verbatim output from `npm run check`.
   - Complete the Definition of Done checklist.
4. **Never auto-merge to main**: All pull requests require review and signoff.
