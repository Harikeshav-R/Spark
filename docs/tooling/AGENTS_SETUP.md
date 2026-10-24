# Agent Tooling, Skills & MCP Server Setup: Spark

This repository contains shared agent skills and Model Context Protocol (MCP) server configurations for all developers and AI coding agents working on Spark.

---

## 1. Directory Structure

```
├── .agents/
│   └── skills/                   # Canonical skill source of truth for all coding agents
├── .claude/
│   ├── mcp.json                  # Claude Code MCP server definitions
│   └── skills -> ../.agents/skills # Symlink to shared skills
├── .omp/
│   ├── mcp.json                  # Oh My Pi (omp) MCP server definitions
│   └── skills -> ../.agents/skills # Symlink to shared skills
├── mcp.json                      # Universal MCP config (Cursor, VS Code, Codex)
├── mcp.json.example              # Template with environment variable documentation
└── docs/tooling/
    └── AGENTS_SETUP.md           # This onboarding and operational guide
```

---

## 2. Included Agent Skills

All skills live in `.agents/skills/` and are accessible to any compatible AI assistant.

### Frontend & UI Craft (Lanes C & D)
- `impeccable`: Design polish, visual audits, typography scales, color contrast, and UI craftsmanship.
- `motion`: Animation standards using `motion/react` (never `framer-motion`), transitions, and gestures.
- `better-ui`: Polish UI surfaces, icons, micro-interactions, and visual hierarchy.
- `better-typography`: Font styling, scale, text wrapping, and punctuation.
- `frontend-start`: Scaffolding new app frontends, layouts, and page structures.
- `web-design-guidelines`: Web interface guidelines review and accessibility auditing.
- `vercel-composition-patterns`: Compound components and scalable React architecture.
- `vercel-react-best-practices`: Next.js 15 / React 19 performance, server vs. client components, bundle hygiene.

### Architecture & Quality Engineering (All Lanes)
- `codebase-design`: Module boundaries, seam placement, and deep modules.
- `domain-modeling`: Domain terminology, `GLOSSARY.md` maintenance, and ADR authoring.
- `diagnosing-bugs`: Systematic root-cause isolation before proposing fixes.
- `safe-refactor`: Restructure code while strictly preserving external behavior.
- `surgical-patch`: Regression-proof narrow bug fixes.
- `investigate-first`: Inspect logs and telemetry before touching code.
- `verify-and-stop`: Validate completion with verifiable evidence before stopping.
- `lean-build`: Strict scope enforcement for new features.
- `migration`: Reversible, compatibility-safe schema and service transitions.
- `improve-codebase-architecture`: High-level structural refactoring patterns.
- `setup-ts-deep-modules`: TypeScript export ergonomics and module boundaries.

### Testing & TDD (All Lanes)
- `tdd`: Red-green-refactor workflows, writing failing tests first.
- `migrate-to-shoehorn`: Type assertion safety, eliminating unsafe `as` casts in test suites.
- `scaffold-exercises`: Scaffolding test harnesses and exercise stubs.

### Git Guardrails, PRs & Workflow (All Lanes)
- `git-guardrails-claude-code`: Blocks destructive git operations (`git push --force`, `git reset --hard`).
- `pr`: Formats conventional pull request descriptions.
- `code-review`: Diff and pull request review guidelines.
- `resolving-merge-conflicts`: Guided git merge and rebase conflict resolution.
- `setup-pre-commit`: Husky pre-commit hooks and lint-staged configuration.
- `handoff`: Multi-session status handoffs and state summaries.

### Token-Saving & Terse Modes (Caveman)
- `caveman`: Terse communication mode, cutting token overhead by 50–70% while preserving technical substance.
- `caveman-commit`: Conventional Commits compressed to pure intent.
- `caveman-review`: Single-line diff review findings.
- `caveman-compress`: Token-saving compression for memory files and documentation.
- `cavecrew`: Delegate tasks to specialized low-token agents.
- `caveman-stats`: Session token usage monitoring.
- `caveman-help`: Caveman command reference.

---

## 3. Configured MCP Servers

| MCP Server | Transport | Execution / Endpoint | Purpose | Required Env Vars |
|---|---|---|---|---|
| `context7` | stdio | `npx -y @upstash/context7-mcp` | Up-to-date documentation for React, Next.js, Supabase, Express, Tailwind | None |
| `shadcn` | stdio | `npx -y shadcn@latest mcp` | Search Shadcn UI component registry and examples | None |
| `motion` | HTTP | `https://mcp.motion.dev` | Motion animation documentation and patterns | None |
| `chrome-devtools`| stdio | `npx -y chrome-devtools-mcp@latest` | Browser console, network, a11y snapshots, screenshots | None |
| `playwright` | stdio | `npx -y @playwright/mcp@latest --isolated` | Isolated browser automation and E2E testing | None |
| `fetch` | stdio | `uvx mcp-server-fetch` | Fast web page fetch and markdown extraction | Python / `uv` |
| `github` | HTTP | `https://api.githubcopilot.com/mcp/` | GitHub PRs, issues, code search | `GITHUB_TOKEN` |
| `postgres` | stdio (Docker) | `crystaldba/postgres-mcp` | Direct PostgreSQL schema & data queries | `DATABASE_URI` + Docker |
| `codebase-memory-mcp` | stdio | `codebase-memory-mcp` | Structural knowledge graph search | Local binary in PATH |
| `agentation` | stdio | `agentation-mcp server` | Browser design annotations server | Local binary in PATH |

---

## 4. Teammate Setup Guide

### Environment Variables
Export the following in your shell (`~/.zshrc`, `~/.bashrc`, or `.env.local`):
```bash
# Required for GitHub MCP server:
export GITHUB_TOKEN="ghp_yourPersonalAccessTokenHere"

# Optional: Required if using Postgres MCP with local Supabase:
export DATABASE_URI="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

### Setup by Client

#### 1. Claude Code
Claude Code automatically discovers skills in `.claude/skills` (symlinked to `.agents/skills`) and MCP servers in `.claude/mcp.json`.
To start:
```bash
claude
```

#### 2. Oh My Pi / Pi (`omp`)
`omp` automatically loads `.omp/mcp.json` and project skills from `.omp/skills`.
To start:
```bash
omp
```

#### 3. Cursor
Cursor reads MCP servers from project-root `mcp.json` (or `.cursor/mcp.json`).
- Open Cursor Settings -> Features -> MCP Servers.
- Ensure the project `mcp.json` is recognized.
- Cursor agent will automatically index skills in `.agents/skills/`.

#### 4. Generic / Other Agents (Codex, Windsurf, OpenCode)
All skills reside in the standard `.agents/skills/` directory. Direct your agent's skill or prompt directory to `.agents/skills/`.
