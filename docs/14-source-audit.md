# Source Audit & Prototype Discrepancy Resolution

This document audits the original prototype implementation in the sibling `prereq` repository, records verified discrepancies between its documentation and actual source code, and details the deliberate corrections implemented in this TypeScript recreation.

---

## 1. Discrepancy Inventory & Resolutions

During the architectural audit of `../prereq/`, several contradictions and security vulnerabilities were identified between the prototype code and its recreation manuals. The table below documents each discrepancy and the authoritative resolution enforced in this repository.

| # | Topic | Prototype Observation (`../prereq/`) | Documented Claim in Recreation Manuals | Authoritative Target Resolution |
|---|---|---|---|---|
| **D01** | **Seed Graph Concept Count** | `scripts/seed_demo.py` lines 146–189 define exactly **33 concept nodes** across 8 categories. | Recreation manuals claimed 35 concepts. | **33 concepts** is canonical. Seed and tests must assert exactly 33 concepts. |
| **D02** | **Seed Graph Edge Count** | `scripts/seed_demo.py` lines 208–244 define exactly **34 prerequisite edges**. | Recreation manuals claimed 36 edges. | **34 edges** is canonical. All 34 edges verified as a valid acyclic DAG. |
| **D03** | **Seed Mastery Rows** | 4 demo students (Hari, Rahul, Praj, Vamshi) $\times$ 33 concepts = **132 mastery rows**. | Manuals implied 140 rows ($4 \times 35$). | Exactly **132 mastery rows** must be seeded and verified. |
| **D04** | **Database Schema Tables** | `scripts/schema.sql` defines **18 distinct tables** (including auth extensions and learning tables). | Recreation manuals inconsistently stated 16 or 22 tables. | Target data model defines **28 application tables** (18 base tables + 3 Spark progression tables + 3 collaboration extension tables + 4 relational tables). |
| **D05** | **Mastery Color & Band Model** | `api/src/routes/students.py` lines 15–25 defined 5 color tiers (`gray`, `orange`, `yellow`, `lime`, `green`). `frontend/src/lib/colors.ts` and `graph.py` defined 4 tiers. | Manuals mixed 4-tier and 5-tier logic. | Consolidated into a single canonical **4-band semantic model**: `gray` ($c=0$), `red` ($0<c<0.40$), `yellow` ($0.40\le c<0.70$), `green` ($c\ge 0.70$). |
| **D06** | **JWT Authentication Bypass** | `api/src/middleware/auth.py` contained an unverified fallback that decoded JWT payloads without checking digital signatures if validation failed. | Manuals assumed standard Supabase JWT validation. | **Eliminated completely**. Server validates every bearer token with Supabase `auth.getUser(token)`. Anonymous database access is disabled. |
| **D07** | **Socket Identity Trust** | `frontend/server/socket.ts` accepted client-supplied `role` and `studentId` query parameters during WebSocket handshakes. | Manuals assumed authenticated sockets. | **Eliminated completely**. Handshakes require a valid Supabase JWT. Server derives user identity and course enrollments strictly from the token. |
| **D08** | **Peer Matchmaking Integrity** | `study_groups.py` matched random, non-opted-in classmates from the course roster and returned a static personal meeting link. | Manuals described intelligent peer study groups. | **Replaced with honest consensual matching**: ephemeral 5-minute pool, explicit concept selection, complementary score $\ge 0.30$, and real mutual availability overlap. |
| **D09** | **Peer Chat Impersonation** | Peer chat feature secretly used an LLM to impersonate an offline student when the peer was unavailable. | Manuals did not disclose bot impersonation. | **Eliminated completely**. In-app chat is strictly human-to-human between matched students. No bot simulation or fake responses. |
| **D10** | **Pedagogical Interventions** | Frontend UI displayed hardcoded static intervention cards regardless of actual poll results. | Manuals described AI-driven lecture interventions. | **Replaced with live AI pipeline**: Anthropic Claude analyzes real aggregate poll evaluations and student response clusters. |
| **D11** | **PDF Extraction Truncation** | `api/src/services/create_kg.py` line 16 silently extracted only the first 10 pages of any uploaded PDF. | Manuals described full syllabus processing. | **Documented and surfaced**: Ingestion bounds extraction to `min(pageCount, 10)`, but explicitly returns `totalPages`, `processedPages`, and `truncated: true` for teacher UI disclosure. |
| **D12** | **Graph Importance Formula** | `create_kg.py` lines 135–154 counted `in_degree` (incoming edges) but docstring claimed "how many nodes depend on this". | Comments conflicted with the mathematical formula. | **Formalized as incoming-prerequisite weighting**: Formula is $\text{sigmoid}(\text{round}(\text{in\_degree} / \text{max\_in}, 3) + 1)$. Acknowledged as weighting nodes by the number of their prerequisites. |

---

## 2. Feature Coverage & Traceability Matrix

Every feature from the prototype and every recreation manual maps directly to target documentation, an owning engineering lane, a planned build task, and an acceptance journey:

| Prototype Module / Recreation Area | Target Document | Lane | Build Task ID | Acceptance ID | Target Implementation Notes |
|---|---|---|---|---|---|
| **Course Creation & Join Codes** | `docs/05-data-model.md`, `docs/06-http-api.md` | Lane A | `P1-A-02` | `J01` | Unique 8-character uppercase join code; idempotent enrollment. |
| **PDF Syllabus Ingestion** | `docs/08-ai-pipelines.md`, `docs/06-http-api.md` | Lane C | `P2-C-01` | `J01` | TypeScript `pdf-lib` extracts up to 10 pages; Anthropic document API. |
| **Knowledge Graph Validation** | `docs/03-invariants.md`, `docs/contracts/service-ports.md` | Lane A | `P2-A-01` | `J01` | Cycle detection via DFS; incoming-prerequisite importance formula. |
| **D3 Graph Visualizer** | `docs/09-frontend.md` | Lane D | `P2-D-02` | `J01`, `J02` | Prerequisite hierarchical ranks; D3-force simulation; a11y support. |
| **Student Enrollment & Mastery Init** | `docs/05-data-model.md`, `docs/03-invariants.md` | Lane A | `P1-A-03` | `J02` | Transactional initialization of 33 mastery rows at `confidence = 0.0`. |
| **Live Lecture Lifecycle** | `docs/06-http-api.md`, `docs/07-realtime.md` | Lane B | `P3-B-01` | `J03` | Transitions `draft` -> `live` -> `completed`; room isolation. |
| **Live Transcript Streaming** | `docs/07-realtime.md`, `docs/06-http-api.md` | Lane B | `P3-B-02` | `J03` | Express ingestion endpoint; Socket.IO broadcast to lecture room. |
| **Live Concept Detection** | `docs/08-ai-pipelines.md` | Lane C | `P3-C-01` | `J03` | Sliding transcript window; Claude fast model; 5-second timeout. |
| **Lecture Attendance Tracking** | `docs/07-realtime.md`, `docs/03-invariants.md` | Lane B | `P3-B-03` | `J03` | Ref-counted socket tracking; $+0.05$ boost for confidence $< 0.30$. |
| **Socratic Poll Generation** | `docs/08-ai-pipelines.md`, `docs/06-http-api.md` | Lane C | `P4-C-01` | `J04` | Anthropic prompt with recent transcript context; 15-second SLA. |
| **Poll Lifecycle & Response Ingestion** | `docs/03-invariants.md`, `docs/06-http-api.md` | Lane B | `P4-B-01` | `J04` | States: `draft` -> `active` -> `closed`; single submission per student. |
| **Server-Side Poll Evaluation** | `docs/08-ai-pipelines.md`, `docs/03-invariants.md` | Lane C | `P4-C-02` | `J04` | Claude evaluation into `correct`, `partial`, `wrong`; atomic mastery update. |
| **Teacher Heatmap & Roster** | `docs/06-http-api.md`, `docs/09-frontend.md` | Lane A / Lane D | `P4-A-02`, `P4-D-01` | `J04` | Course-wide aggregate distribution across 4 semantic mastery bands. |
| **Pedagogical Interventions** | `docs/08-ai-pipelines.md`, `docs/09-frontend.md` | Lane C / Lane D | `P4-C-03`, `P4-D-02` | `J05` | Real-time AI analysis of poll misconception clusters and teaching actions. |
| **Lecture Summarization** | `docs/08-ai-pipelines.md`, `docs/06-http-api.md` | Lane C | `P3-C-02` | `J05` | Structured summary, key concepts, and timestamped transcript links. |
| **Socratic Tutoring Chat** | `docs/08-ai-pipelines.md`, `docs/09-frontend.md` | Lane C | `P5-C-01` | `J06` | Multi-turn pedagogical chat; Socratic guidance; understanding evidence. |
| **Concept Learning Pages** | `docs/08-ai-pipelines.md`, `docs/06-http-api.md` | Lane C | `P5-C-02` | `J06` | Generated markdown guides with definitions, examples, and pitfalls. |
| **Server-Graded Practice Quizzes** | `docs/03-invariants.md`, `docs/06-http-api.md` | Lane C | `P5-C-03` | `J06` | 5-question multiple choice; server validates indices against stored key. |
| **Perplexity Resource Search & Ask** | `docs/08-ai-pipelines.md` | Lane C | `P5-C-04` | `J06` | Grounded academic web search with citations; 10-second SLA. |
| **Consensual Peer Matchmaking** | `docs/03-invariants.md`, `docs/06-http-api.md` | Lane B | `P6-B-01` | `J07` | Ephemeral pool; complementary gap score $\ge 0.30$; transactional pair creation. |
| **Real Peer Chat** | `docs/06-http-api.md`, `docs/07-realtime.md` | Lane B | `P6-B-02` | `J07` | Authenticated peer messaging; persist-before-publish via Socket.IO. |
| **Mutual Availability Scheduling** | `docs/03-invariants.md`, `docs/06-http-api.md` | Lane B | `P6-B-03` | `J07` | Stored UTC half-open intervals; earliest 30-min overlap; bilateral acceptance. |
| **Authentic Zoom Integration** | `docs/06-http-api.md`, `docs/10-security.md` | Lane B | `P6-B-04` | `J07` | Teacher OAuth 2.0 flow; creates genuine Zoom meeting via REST API. |
| **Deterministic Seed & Demo** | `docs/13-demo-and-acceptance.md`, `docs/12-operations.md` | Lane A | `P1-A-04`, `P7-A-02` | `J08` | 33 concepts, 34 edges, 4 students, 132 mastery rows; zero cloud cost. |
| **Persistent Host Deployment** | `docs/02-architecture.md`, `docs/12-operations.md` | Lane A | `P7-A-01` | `J08` | Single-process Node.js deployment on Render; HTTPS/WSS; health checks. |
| **Warm Star Vessel Visualizer** | `docs/09-frontend.md` | Lane D | `P2-D-02`, `P1-D-02` | `J02` | D3-force layout; SVG star vessels with bottom-up vertical confidence fill; canonical bands. |
| **Spark Mascot & Moods** | `docs/09-frontend.md` | Lane D | `P2-D-03` | `J10` | Embedded SVG mascot; 5 moods (`calm`, `think`, `cheer`, `oops`, `sleepy`); 4 forms (`ember` to `nova`). |
| **Daily Quests & Streak Ledger** | `docs/03-invariants.md`, `docs/05-data-model.md` | Lane A | `P5-A-02` | `J09` | 3 ready review concepts; overdue priority; streak increments on clear; 25 XP bonus. |
| **Practice Encounters & Hints** | `docs/08-ai-pipelines.md`, `docs/06-http-api.md` | Lane C | `P5-C-06`, `P5-C-07` | `J09` | 5-question quiz wrapper; sequential 3-tier hints; XP discount; canonical quiz evidence. |
| **Eclipse Review Pressure** | `docs/03-invariants.md`, `docs/09-frontend.md` | Lane A / Lane D | `P5-A-02`, `P5-D-03` | `J10` | Distance from 0.70 mastery across up to 3 ready concepts; exam countdown. |
| **Collaborative Party Quests** | `docs/05-data-model.md`, `docs/06-http-api.md` | Lane B / Lane C | `P6-A-02`, `P6-B-05`, `P6-C-01` | `J11` | Matched peers; candidate invites; bilateral independent quiz verification; 60 XP each. |
| **Class Sky & Effort Roster** | `docs/03-invariants.md`, `docs/09-frontend.md` | Lane A / Lane D | `P4-A-03`, `P4-D-03` | `J11` | Class mean stars; taught attention rings; `high_effort_low_mastery` flag at XP $\ge 75\%$ & conf $\le 40\%$. |

---

## 3. Reference Cleanup & Sanitization

To ensure that this repository is completely self-contained and secure, the following sanitization policies are enforced:
- **No Shared Credentials**: All hardcoded passwords, JWT secrets, and test user tokens from the prototype have been purged. Testing uses synthetic email addresses (`@example.test`) and locally supplied environment secrets.
- **No Personal Meeting URLs**: All static personal meeting room links used in prototype mockups have been removed. Meeting generation must connect to genuine Zoom API endpoints or remain explicitly marked as unavailable.
- **No Claims of Measured Latency**: Historical claims regarding prototype response times (e.g., "1.2 second average poll grading") are classified as historical observations, not engineering SLAs. Target SLAs are defined as strict bounding timeouts in [docs/08-ai-pipelines.md](08-ai-pipelines.md).

---

## 4. Spark Proposal Provenance & Architectural Boundary Record

### 4.1 Provenance Baseline
On October 21, 2026, commit `7cce61cfa6c699148dfc30512f84c215642d8c7b` introduced `SPARK_DESIGN.md` and `SPARK_TECHNICAL.md` to explore gamified engagement mechanics for the Spark platform.

### 4.2 Audit of Accepted vs Rejected Proposals
The following table records the authoritative architectural decisions governing each proposed element:

| Proposed Spark Element | Proposed Direction in Draft | Authoritative Status in Canonical Suite | Canonical Authority Reference |
|---|---|---|---|
| **Companion Mascot (Spark)** | SVG reactive mascot with 5 moods and 4 evolution forms | **Accepted**: Implemented as pure SVG component with deterministic copy and reduced-motion compliance. | `docs/09-frontend.md` Section 4, `P2-D-03` |
| **Daily Review Quests** | Daily queue of review topics with streak tracking | **Accepted**: Persisted queue of up to 3 ready concepts per UTC date; streak increments upon clear. | `docs/03-invariants.md` Section 7.4, `P5-A-02` |
| **Progressive Tiered Hints** | 3 hint levels (Nudge, Bigger hint, Walkthrough) | **Accepted**: Server-stored and sequentially unlocked ($1 \to 2 \to 3$); discounts XP without altering quiz scoring. | `docs/03-invariants.md` Section 7.5, `P5-C-06` |
| **Eclipse Diagnostic** | Visual indicator of exam review pressure | **Accepted**: Mathematical formula based on distance to $c=0.70$ on up to 3 ready concepts; never decays confidence. | `docs/03-invariants.md` Section 7.7, `P5-A-02` |
| **XP Effort Ledger** | Gamified experience points | **Accepted as Orthogonal Metric**: Server-authoritative append-only `xp_events` ledger; strictly decoupled from mastery. | `docs/03-invariants.md` Section 7.6, `P5-A-02` |
| **Collaborative Party Goals** | Cooperative quests for matched peers | **Accepted over Consensual Pairs**: 2-student matches embark on 1–3 shared concepts; bilateral quiz verification; 60 XP each. | `docs/03-invariants.md` Section 7.9, `P6-B-05` |
| **Class Sky & Effort Roster** | Instructor graph and effort quadrant | **Accepted**: Aggregate mean confidence stars, taught attention rings, and `high_effort_low_mastery` percentile flag. | `docs/03-invariants.md` Section 7.10, `P4-A-03`, `P4-D-03` |
| **Python Flask Dual Runtime** | Revert to split Flask + Next.js architecture | **Rejected**: Preserved single-process TypeScript Node.js 24 runtime with Express 5 and Next.js 16. | ADR 0001, ADR 0002, ADR 0012 |
| **Static Transit-Map Layout** | Hardcoded grid/lane knowledge graph engine | **Rejected**: Preserved D3-force dynamic physics simulation with prerequisite depth stratification. | ADR 0006, `docs/09-frontend.md` Section 3 |
| **60/85 Mastery Thresholds** | Replace 4 bands with 3 arbitrary percentage buckets | **Rejected**: Preserved 4 canonical bands (`gray`, `red`, `yellow`, `green`) with star fill height proportional to confidence. | ADR 0005, ADR 0012, INV-M02, INV-XP01 |
| **Mastery Confidence Decay** | Automated time-decay on student confidence | **Rejected**: Confidence decays only through negative poll evaluation; automated decay is strictly prohibited. | ADR 0005, INV-M01, INV-XP02 |
| **Unconstrained Group Matching** | 3+ student groups without gap scoring | **Rejected**: Preserved bilateral 2-student matching with complementary gap $\ge 0.30$ and bilateral scheduling consent. | ADR 0009, INV-C01–INV-C05 |

### 4.3 Self-Sufficiency & Deletion Safety Guarantee
With the completion of this integration, the canonical documentation suite (`docs/` and root files) is **100% self-contained**:
1. No canonical manual, specification, or test plan relies on `SPARK_DESIGN.md` or `SPARK_TECHNICAL.md`.
2. No canonical document requires access to `spark.html` or external prototype assets.
3. The user may delete `SPARK_DESIGN.md` and `SPARK_TECHNICAL.md` at any time without creating dangling links, missing requirements, or specification ambiguities.
