# ADR 0006: Prerequisite DAG Modeling & Bounded Syllabus Ingestion

## Status
Accepted

## Context
Automated extraction of prerequisite knowledge graphs from PDF documents presents key reliability and integrity challenges:
1. Syllabus extraction without clear pagination bounds can silently truncate pages without notifying the user.
2. LLM graph generation requires server-side validation against cycles, self-edges, and missing endpoints to ensure topological consistency.
3. Node importance calculations must be unambiguously formalized to reflect incoming-prerequisite depth.

## Decision
We enforce formal graph and ingestion constraints:
1. **Bounded Extraction with Explicit Disclosure**: The syllabus extraction pipeline accepts PDFs up to 50 MiB, slices the first `min(pageCount, 10)` pages using `pdf-lib`, and explicitly returns `totalPages`, `processedPages`, and `truncated: boolean` to the teacher UI.
2. **Two-Phase Commit**: Syllabus upload generates a preview DTO. Persisting the graph to the database requires an explicit, separate confirmation step (`POST /api/courses/:courseId/graph`). A course with an existing graph rejects re-commits with `409 GRAPH_ALREADY_EXISTS`.
3. **Formal DAG Validation**: The server validates that the proposed graph has 1 to 40 nodes, zero self-edges, zero duplicate labels, all edge endpoints exist, and the graph is strictly acyclic (verified via Depth-First Search cycle detection).
4. **Canonical Prerequisite Direction**: Edges are strictly directed from prerequisite to dependent (`source_id -> target_id` means `source` is prerequisite to `target`).
5. **Incoming-Prerequisite Importance Formula**: The importance formula is formalized as incoming-prerequisite weighting:
   $$\text{importance} = \text{sigmoid}\left(\text{round}\left(\frac{\text{in\_degree}}{\text{max\_in}}, 3\right) + 1\right)$$
   (where $\text{max\_in}=0 \implies \text{score}=0.5$).

## Why
- Prevents syllabus extraction timeouts and excessive LLM token costs while providing honest disclosure to instructors.
- Guarantees that the knowledge graph is structurally sound and renderable without infinite loops in ancestor traversal algorithms.
- Mathematically aligns the codebase documentation with the exact formula executed by the system.

## Consequences
- Syllabus documents longer than 10 pages will have later sections truncated unless instructors provide consolidated syllabus summaries.
- Modifying a course graph after initial commit requires creating a new course entity in this release scope.
