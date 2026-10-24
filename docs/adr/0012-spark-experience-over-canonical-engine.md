# ADR 0012: Spark Experience Layer Over Canonical Engine

## Status
Accepted

## Context
Vamshi proposed the Spark product specification (`SPARK_DESIGN.md` and `SPARK_TECHNICAL.md`), introducing a high-engagement gamified layer: the reactive SVG mascot Spark, Daily Quests with streak tracking, practice Encounters with three progressive hint tiers, an Eclipse review-pressure diagnostic, an append-only XP effort ledger, collaborative Party quests, and an instructor Class Sky aggregate visualization.

However, the Spark technical draft also proposed:
1. Reverting to a legacy Python Flask + Next.js dual-backend architecture.
2. Replacing the D3-force dynamic knowledge graph with a static transit-map layout requiring hardcoded lane and order properties.
3. Overriding the mathematically verified four-band mastery engine with alternate 60/85 mastery thresholds, confidence decay, and penalty-free retries.
4. Altering the consensual 2-student peer collaboration system into an unconstrained multi-party group format.

## Decision
We approve and adopt the **Spark Experience Layer** as the canonical user-facing product experience while maintaining strict separation from core platform architecture:

1. **Architecture & Runtime Inviolability**: The platform remains exclusively on the Node.js 24 + TypeScript 5.8 + Express 5 + Next.js 16 single-process runtime (ADR 0001, ADR 0002) backed by Supabase PostgreSQL (ADR 0003). No Flask backend or Python services are introduced.
2. **Mastery Engine & Band Inviolability**: The single-writer mastery engine, $[0.0, 1.0]$ confidence scalar, four canonical bands (`gray`, `red`, `yellow`, `green`), and four exact evidence formulas (`poll`, `tutor`, `quiz`, `attendance`) remain unmodified (ADR 0005, INV-M01–INV-M03). Visual star states map one-to-one to canonical bands:
   - `gray` = Unassessed ($c = 0.0$)
   - `red` = Dim / Needs practice ($0.0 < c < 0.40$)
   - `yellow` = Lit / Developing ($0.40 \le c < 0.70$)
   - `green` = Shining / Mastered ($c \ge 0.70$)
   Confidence decay, ease factors, and 60/85 threshold schemes are rejected.
3. **Graph Layout Inviolability**: The knowledge graph continues to use D3-force dynamic simulation with prerequisite-depth stratification, repulsion, and ancestor highlighting (ADR 0006, INV-G01–INV-G07). Stars render at D3-computed coordinates with vertical SVG clip rectangles representing confidence fill height. Static transit-map lanes are rejected.
4. **Effort Orthogonality**: Experience points (XP) and daily streaks are recorded in an append-only server-authoritative ledger (`xp_events`). XP and streaks measure effort, never academic confidence. XP never mutates `student_mastery`.
5. **Encounter Orchestration**: Practice Encounters wrap the existing five-question, four-option practice quiz pipeline. Encounters introduce three progressive hint tiers (Nudge, Bigger hint, Walkthrough) stored and released server-side. Hints discount XP awarded but have zero effect on quiz scoring or mastery evidence.
6. **Consensual Collaboration & Party Goals**: Peer matching remains strictly bilateral (two students), requiring an opt-in pool, knowledge gap $\ge 0.30$, and mutual scheduling consent (ADR 0009, INV-C01–INV-C05). Matched peers can undertake shared Party quests (1–3 concepts) where each peer independently completes quiz verification, awarding shared XP upon bilateral completion without bypassing mastery rules.
7. **Instructor Class Sky**: Instructors receive an aggregate Class Sky graph showing mean class confidence across concepts, taught/untaught transcript status, and an effort-vs-mastery quadrant roster based on XP and confidence percentiles, without exposing student-facing leaderboards.

## Why
- Preserves months of architectural rigor, mathematical invariants, relational consistency, and offline deterministic testing.
- Adopts the motivational power of Spark's mascot, daily habit loops, tiered hints, and collaborative quests to maximize student retention and learning outcomes.
- Prevents architectural divergence, dual-runtime operational overhead, and degradation of rigorous mastery assessment.

## Consequences
- Requires additive schema migrations (6 new tables, 28 total application tables) for encounters, daily quests, XP events, and party collaboration.
- Preserves all existing Phase 0 contracts as the baseline; introduces new game contracts in Phase 1 (`src/contracts/game.ts`).
- Lane A stewards game progression storage, Lane C stewards Encounter and hint orchestration, Lane B stewards party quests, and Lane D stewards mascot and Class Sky rendering.
