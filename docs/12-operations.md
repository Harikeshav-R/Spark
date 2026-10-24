# Operations, Deployment & Runbooks

This document specifies the operational lifecycle, developer environment setup, database migrations, configuration matrix, and persistent production deployment for Spark.

---

## 1. Developer Environment & Toolchain Setup

### 1.1 Host Prerequisites
- **Node.js**: `v24.x` (LTS)
- **Package Manager**: `npm` (with committed `package-lock.json`)
- **Docker**: Engine `26+` and Docker Compose (for local Supabase instance)
- **Supabase CLI**: `v1.170+`

### 1.2 Quickstart Sequence (Local Development)
```bash
# 1. Install dependencies
npm ci

# 2. Start local Supabase containers (PostgreSQL, Auth)
npx supabase start

# 3. Apply ordered schema migrations
npm run db:migrate

# 4. Seed canonical demo curriculum (CS229 with 33 concepts, 34 edges)
npm run db:seed

# 5. Verify local configuration and health
npm run doctor

# 6. Start the persistent development server (port 3000)
npm run dev
```

---

## 2. Command Reference Catalog

All project operations are executed through standard npm scripts defined in `package.json`:

| Command | Action / Subsystem |
|---|---|
| `npm ci` | Installs exact dependencies from committed `package-lock.json`. |
| `npm run dev` | Starts persistent custom server (`server/index.ts`) in development mode with HMR on port 3000. |
| `npm run build` | Compiles TypeScript backend and Next.js frontend assets for production. |
| `npm start` | Launches the compiled persistent Node.js server (`dist/server/index.js`) on port 3000. |
| `npm run typecheck` | Executes `tsc --noEmit` across all server and client TypeScript modules. |
| `npm run lint` | Runs ESLint 9 across all codebase files. |
| `npm test` | Runs isolated unit and contract tests in memory (`INTEGRATION_MODE=fixture`). |
| `npm run test:contracts` | Validates Zod schemas, service ports, and boundary import rules. |
| `npm run test:integration` | Runs PostgreSQL database integration tests against local Supabase. |
| `npm run test:e2e` | Runs Playwright multi-browser end-to-end user journeys (J01–J11). |
| `npm run check` | Unified offline check: runs `typecheck`, `lint`, `test`, and `test:contracts`. |
| `npm run doctor` | Validates required environment variables, database connectivity, and provider readiness. |
| `npm run db:migrate` | Applies unapplied SQL migration files from `supabase/migrations/`. |
| `npm run db:seed` | Seeds deterministic CS229 demo course (33 concepts, 34 edges, 4 students, 132 mastery rows, Daily Quests, XP events, party quests). |
| `npm run demo -- --mode=fixture --seed=42` | Runs an automated offline demonstration using deterministic fixtures. |
| `npm run demo -- --mode=live --seed=42` | Runs an automated live demonstration exercising authentic cloud APIs. |
| `npm run demo:reset` | Wipes transient demo state and restores baseline seed in under 2 seconds for fresh presentation takes. |
| `npm run demo:record` | Runs automated Playwright demonstration recording 1080p video to `recordings/demo-walkthrough.webm`. |

---

## 3. Environment Configuration Matrix

The application configuration is loaded via environment variables and validated at startup using Zod:

| Variable Name | Required | Default (Dev) | Description & Constraints |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Runtime environment (`development`, `test`, `production`). |
| `PORT` | No | `3000` | Port for Express HTTP and Next.js (single root port). |
| `APP_ORIGIN` | Yes | `http://localhost:3000` | Fully qualified base URL for CORS and OAuth redirects. |
| `SUPABASE_URL` | Yes | `http://127.0.0.1:54321` | Supabase API gateway URL. |
| `SUPABASE_ANON_KEY` | Yes | (Local key) | Anonymous public key for browser client Auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | (Local key) | Privileged service key for server backend queries. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | `http://localhost:3000` | Client-exposed Supabase URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | (Local key) | Client-exposed anonymous key. |
| `OPENROUTER_API_KEY` | Live only | `""` | OpenRouter unified API key for AI models. |
| `OPENROUTER_FAST_MODEL` | No | `minimax/minimax-m3.1-flash:free` | Fast model for detection, understanding checks, and grading. |
| `OPENROUTER_DEEP_MODEL` | No | `nvidia/nemotron-3-ultra-550b-a55b:free` | Deep model for syllabus extraction, tutoring, and summaries. |
| `OPENROUTER_SEARCH_MODEL` | No | `perplexity/sonar-pro` | Perplexity search model identifier on OpenRouter. |
| `ZOOM_CLIENT_ID` | Live only | `""` | Zoom Marketplace App OAuth Client ID. |
| `ZOOM_CLIENT_SECRET` | Live only | `""` | Zoom Marketplace App OAuth Client Secret. |
| `ZOOM_SECRET_TOKEN` | Live only | `""` | Zoom Webhook secret token for HMAC verification. |
| `ZOOM_REDIRECT_URI` | Live only | `${APP_ORIGIN}/auth/zoom/callback` | OAuth redirect callback URL. |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | `0123...cdef` (64-hex) | 256-bit key for encrypting Zoom secrets at rest. |
| `INTEGRATION_MODE` | Yes | `fixture` | Controls provider adapters (`fixture` or `live`). |
| `LECTURE_SOURCE` | Yes | `simulator` | Transcript source (`simulator` or `zoom`). |
| `DEMO_PASSWORD` | No | `DemoPass123!` | Password assigned to seeded demo accounts. |
| `DEMO_MODE` | No | `false` | Enables floating `DemoToolbar` and non-production demo endpoints (`true`/`false`). |
| `DEMO_AUTO_RESPOND` | No | `false` | Enables one-click simulated student responses during live poll demonstrations. |
| `DEMO_TICK_RATE_MS` | No | `4000` | Cadence interval in milliseconds for simulated speech chunks. |

---

## 4. Production Host Deployment (Render)

The application is deployed as a single persistent service on **Render** (or equivalent container host) with the following specifications:
1. **Persistent Process Guarantee**: Must run on a persistent instance (Web Service), NOT serverless functions. Persistent memory is required for Socket.IO rooms, presence maps, and Zoom RTMS streams.
2. **Build & Start Commands**:
   - Build Command: `npm ci && npm run build`
   - Start Command: `npm start` (runs `node dist/server/index.js`)
3. **Health Check Endpoint**: Configured to probe `GET /api/health` every 15 seconds.
4. **Graceful Shutdown**: Upon receiving `SIGTERM` or `SIGINT`, the server stops accepting new HTTP/WSS requests, flushes pending database evidence rows, broadcasts `lecture:ended` to any active lecture rooms, and exits cleanly within 10 seconds.
