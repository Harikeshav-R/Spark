# ADR 0008: Validated AI Pipelines with Honest Failure Modes

## Status
Accepted

## Context
Educational platforms leveraging Large Language Models (LLMs) often exhibit brittle prompt integrations, unvalidated JSON parsing, and dishonest failure fallbacks. For instance, in the prototype:
- Malformed JSON responses from poll evaluations or concept detections often defaulted silently to partial credit or empty state without informing the instructor.
- Mockups sometimes displayed static, hardcoded intervention cards when AI generation was unavailable.
- Unbounded API calls caused request timeouts and frozen UI states.

## Decision
We enforce strict schema validation, bounded execution timeouts, and honest failure reporting across all 13 AI capabilities:
1. **Zod Runtime Validation**: All structured outputs returned by Anthropic Claude or Perplexity AI MUST be validated against strict Zod schemas before being accepted by domain services. Untrusted model text that fails schema parsing is immediately rejected.
2. **Explicit Per-Capability Timeouts**:
   - Concept Detection & Understanding Checks: 5 seconds
   - Poll Evaluation & Misconception Summaries: 8 seconds
   - Web Resource Search & Citation Q&A: 10 seconds
   - Poll Generation, Tutoring Response, Lecture Summaries: 15 seconds
   - Teacher Interventions: 30 seconds
   - Learning Page & Quiz Generation: 60 seconds
   - Syllabus PDF Graph Extraction: 120 seconds
3. **No Fabricated Fallbacks**: If an AI call times out, encounters a rate limit, or fails schema validation, the system MUST NOT generate fake evaluations, invented web citations, or hardcoded generic interventions.
4. **Honest User-Facing Errors**: A failed poll evaluation leaves the student's submission in an explicit `pending_evaluation` or `failed_evaluation` status with zero mastery mutation, allowing the teacher or student to retry. Missing API credentials in live mode immediately return `503 SERVICE_UNAVAILABLE`.

## Why
- Protects academic integrity: students never receive arbitrary grades or hallucinated facts caused by silent fallback logic.
- Prevents cascading system failures and unhandled promise rejections.
- Provides clear diagnostic signals to instructors and developers when third-party AI APIs degrade.

## Consequences
- Requires robust UI error states for all AI-backed features (retry buttons, failure banners).
- Students may occasionally experience delayed poll evaluations during upstream provider degradation.
