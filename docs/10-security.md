# Security, Identity & Privacy Specification

This document details the security controls, access control matrices, authentication protocols, secrets management, and privacy boundaries governing Spark.

---

## 1. Authentication & Token Verification

### 1.1 Supabase JWT Validation
- **Server-Side Token Verification**: Every incoming HTTP request (with `Authorization: Bearer <token>`) and WebSocket connection handshake is verified by calling Supabase Auth's `auth.getUser(token)` endpoint using a dedicated, non-privileged authentication client.
- **No Unverified Fallbacks**: If JWT signature verification or token expiry checks fail, the request MUST be terminated immediately with `401 Unauthorized`. Insecure fallbacks that decode JWT payloads without signature checking are strictly prohibited.
- **Session Expiry**: Access tokens expire per Supabase configuration (typically 3,600 seconds). Clients refresh tokens using standard refresh tokens before making authenticated API calls.
- **No LocalStorage Identity Trust**: Client requests never supply raw `studentId` or `role` headers as proof of identity. The server extracts the verified `auth.users.id` from the verified token and queries trusted database enrollment records to derive the `ActorContext`.

---

## 2. Role-Based Access Control (RBAC) Matrix

Because server repositories use `SUPABASE_SERVICE_ROLE_KEY` to interact with PostgreSQL, all access control checks are enforced explicitly in application service layers:

| Resource / Endpoint Family | Public (Anon) | Enrolled Student | Non-Enrolled Student | Course Teacher | Non-Owning Teacher |
|---|---|---|---|---|---|
| `GET /api/health` | **Allow** | **Allow** | **Allow** | **Allow** | **Allow** |
| `POST /api/auth/{signup,login}` | **Allow** | **Allow** | **Allow** | **Allow** | **Allow** |
| `POST /api/courses` | Deny (`401`) | Deny (`403`) | Deny (`403`) | **Allow** | **Allow** |
| `GET /api/courses/:courseId` | Deny (`401`) | **Allow** | Deny (`403`) | **Allow** | Deny (`403`) |
| `POST /api/courses/enroll` | Deny (`401`) | **Allow** | **Allow** | Deny (`403`) | Deny (`403`) |
| `POST /api/courses/:id/upload` | Deny (`401`) | Deny (`403`) | Deny (`403`) | **Allow** | Deny (`403`) |
| `POST /api/courses/:id/graph` | Deny (`401`) | Deny (`403`) | Deny (`403`) | **Allow** | Deny (`403`) |
| `GET /api/courses/:id/heatmap` | Deny (`401`) | Deny (`403`) | Deny (`403`) | **Allow** | Deny (`403`) |
| `GET /api/courses/:id/students` | Deny (`401`) | Deny (`403`) | Deny (`403`) | **Allow** | Deny (`403`) |
| `GET /api/students/:id/mastery` | Deny (`401`) | **Allow (Self Only)** | Deny (`403`) | **Allow (Course Owner)** | Deny (`403`) |
| `POST /api/lectures/:id/poll/*` | Deny (`401`) | Deny (`403`) | Deny (`403`) | **Allow** | Deny (`403`) |
| `POST /api/polls/:id/respond` | Deny (`401`) | **Allow (Attending Only)**| Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `POST /api/tutoring/sessions` | Deny (`401`) | **Allow** | Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `POST /api/study-groups/opt-in`| Deny (`401`) | **Allow** | Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `study-group:<matchId>` Socket| Deny (`401`) | **Allow (Matched Pair)** | Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `PUT /api/courses/:id/exam` | Deny (`401`) | Deny (`403`) | Deny (`403`) | **Allow** | Deny (`403`) |
| `GET /api/courses/:id/students/effort` | Deny (`401`) | Deny (`403`) | Deny (`403`) | **Allow** | Deny (`403`) |
| `GET /api/students/:id/daily-quest` | Deny (`401`) | **Allow (Self Only)** | Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `GET /api/students/:id/game-summary`| Deny (`401`) | **Allow (Self Only)** | Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `POST /api/students/:id/encounters` | Deny (`401`) | **Allow (Self Only)** | Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `POST /api/encounters/:id/hints` | Deny (`401`) | **Allow (Owner Only)** | Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `POST /api/encounters/:id/submit`| Deny (`401`) | **Allow (Owner Only)** | Deny (`403`) | Deny (`403`) | Deny (`403`) |
| `POST /api/study-groups/:id/quests`| Deny (`401`) | **Allow (Matched Pair)** | Deny (`403`) | Deny (`403`) | Deny (`403`) |

---

## 3. Secret Management & Provider Integrations

### 3.1 Encryption at Rest for Zoom Credentials
- Teacher Zoom credentials (`zoom_client_id`, `zoom_client_secret`, `zoom_refresh_token`) stored in the `teachers` table are encrypted at rest using **AES-256-GCM**.
- The `CREDENTIAL_ENCRYPTION_KEY` (a 256-bit hexadecimal string) is stored strictly in server environment variables and NEVER exposed to clients or checked into git.
- Plaintext credentials and access tokens are never returned over HTTP API endpoints.

### 3.2 Zoom Webhook HMAC Verification
Zoom webhook deliveries (`POST /webhook/zoom/:teacherId`) are protected against tampering and replay attacks:
1. **Timestamp Freshness**: The server verifies that the `x-zm-request-timestamp` is within 5 minutes of server time.
2. **HMAC-SHA256 Signature Verification**: The server computes:
   $$\text{message} = \text{"v0:"} + \text{timestamp} + \text{":"} + \text{rawBody}$$
   $$\text{expectedSignature} = \text{"v0="} + \text{HMAC-SHA256}(\text{ZOOM\_SECRET\_TOKEN}, \text{message})$$
   The calculated signature is compared against the `x-zm-signature` header using timing-safe buffer comparison (`crypto.timingSafeEqual`).

---

## 4. Input Sanitization & Content Security

1. **PDF Syllabus Bounding**: Ingestion strictly enforces a **50 MiB** payload cap (`413 Payload Too Large` if exceeded) and a 10-page processing limit via `pdf-lib`.
2. **Markdown & Math Sanitization**: All AI-generated content (learning pages, tutoring messages, poll questions) rendered in the browser is sanitized via `DOMPurify` before insertion into the DOM to prevent Cross-Site Scripting (XSS).
3. **No Expected Answer Leaks**: Poll question broadcast events (`poll:new-question`) and quiz question queries (`GET /api/concepts/:id/quiz`) explicitly strip expected answers, rubrics, and correct answer indices from the payload.
4. **Server-Side Grading Integrity**: Student poll and quiz grading is executed exclusively on the server against pre-stored rubrics. Client-submitted score deltas are discarded.
5. **No Hint Answer Leaks**: Encounter hint endpoints release pedagogical nudges and walkthroughs without revealing the correct option index or exact option string.

---

## 5. Learner Privacy & Data Handling

1. **No Learner Data in Public Caches**: Endpoints returning personal confidence, student answers, or chat messages include `Cache-Control: private, no-store`.
2. **Minimization of AI Context**: Transcripts and student answers sent to Anthropic Claude are stripped of student emails and real full names; only synthetic or anonymized student tokens (e.g., `student_1`, `student_2`) are included in misconception analysis prompts.
3. **Synthetic Demo Data**: Demonstration scripts and seed fixtures use synthetic personas (Hari, Rahul, Praj, Vamshi) with `@example.test` email domains and locally generated test passwords.
4. **Teacher-Only Effort Quadrant & Class Sky**: Student XP, effort percentiles, and `high_effort_low_mastery` flags are visible exclusively to the course teacher. Student-facing leaderboards or public XP comparisons are strictly prohibited.
5. **Selected-Concept-Only Study Pool Disclosure**: Study pool candidate listings (`GET /api/courses/:courseId/study-groups/candidates`) disclose only requested concept IDs, confidence bands on those specific concepts, and fit classification. Non-requested concept mastery is never exposed to prospective peers.
