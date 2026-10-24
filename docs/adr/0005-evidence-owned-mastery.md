# ADR 0005: Evidence-Owned Mastery Calculation Engine

## Status
Accepted

## Context
In the prototype, student confidence was updated through disparate HTTP endpoints, sometimes allowing arbitrary delta values or direct score overwrites. Attempt counters were inconsistently incremented across polls, attendance, and practice quizzes. Furthermore, the backend defined 5 mastery color tiers (`gray`, `orange`, `yellow`, `lime`, `green`) while the frontend and graph visualizers defined 4 tiers.

## Decision
We consolidate all student confidence calculation into a single, evidence-owned domain engine managed by Lane A (`MasteryService`):
1. **Four Canonical Semantic Bands**:
   - `gray`: $c = 0.0$ (unassessed / zero evidence)
   - `red`: $0.0 < c < 0.40$ (struggling / urgent intervention)
   - `yellow`: $0.40 \le c < 0.70$ (developing / partial comprehension)
   - `green`: $c \ge 0.70$ (mastered / confident)
2. **Discriminated Evidence Union**: Direct confidence manipulation is strictly prohibited. Confidence mutations MUST provide a verified `MasteryEvidence` object:
   - `poll`: Formative poll evaluation (`correct` $\to \max(old, 0.85)$, `partial` $\to \max(old, 0.50)$, `wrong` $\to 0.20$ if $old=0$ else $\min(old, 0.20)$).
   - `tutor`: Verified Socratic understanding breakthrough (`clamp(old + 0.20, 0, 1)`).
   - `quiz`: Server-evaluated practice quiz score ($\ge 80\% \to +0.15$, $\ge 60\% \to +0.10$, $\ge 40\% \to +0.05$, else $+0.02$).
   - `attendance`: Verified lecture presence during active concept discussion ($\min(old + 0.05, 0.30)$ only if $old < 0.30$).
3. **Attempt Counter Invariant**: The `student_mastery.attempts` counter counts evaluated poll responses only. Attendance boosts, tutoring breakthroughs, and practice quizzes do not increment this counter.
4. **Atomic RPC Execution**: Mastery updates are applied through a PostgreSQL stored procedure (`apply_mastery_evidence`) that records the immutable evidence row and updates `student_mastery` in a single transaction.

## Why
- Guarantees mathematical determinism and prevents race conditions.
- Enforces pedagogical integrity: confidence cannot be manipulated by untrusted client parameters or malformed score deltas.
- Reconciles the conflicting 4-tier and 5-tier color models into an unambiguous 4-band domain model.

## Consequences
- Requires all feature modules (Classroom, Tutoring, Quizzes) to route mastery changes through the formal `MasteryService` rather than directly issuing SQL updates.
- Historical mastery state can be fully audited or replayed from the `mastery_evidence` table.
