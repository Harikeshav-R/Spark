# Frontend & Client Architecture: Next.js 16 & React 19

This document specifies the user interface architecture, route hierarchy, feature component mounting, D3-force knowledge graph visualization, and accessibility standards.

---

## 1. Route Hierarchy & Component Ownership

Route shells are authored and maintained by **Lane D** within `src/app/`. Autonomous feature views authored by **Lane C** are mounted inside these route shells via typed exported components.

```text
src/app/
├── layout.tsx                                      # Global HTML shell, theme, font, toast provider
├── page.tsx                                        # Route: / (Landing & Auth)
├── professor/
│   ├── dashboard/page.tsx                          # Route: /professor/dashboard
│   └── upload/page.tsx                             # Route: /professor/upload
└── student/
    └── [studentId]/
        ├── page.tsx                                # Route: /student/[studentId] (Student Graph & Lecture)
        ├── tutor/page.tsx                          # Route: /student/[studentId]/tutor (Mounts TutorFeature)
        ├── study-group/page.tsx                    # Route: /student/[studentId]/study-group (Mounts StudyGroupFeature)
        ├── summaries/page.tsx                      # Route: /student/[studentId]/summaries (Lecture summaries)
        └── concepts/
            └── [conceptId]/page.tsx                # Route: /student/[studentId]/concepts/[conceptId] (Mounts LearningFeature)
```

### Lane C Feature Component Contracts
Lane C exports three self-contained feature views from `src/features/`:
1. `TutorFeature`: Interactive multi-turn Socratic chat interface with KaTeX rendering.
2. `StudyGroupFeature`: Ephemeral pool opt-in, mutual availability picker, real peer chat, and Zoom link display.
3. `LearningFeature`: Concept learning guide, server-graded 5-question practice quiz, and cited resource search.

All feature props accept standard DTOs (`ActorContext`, `Student`, `ConceptNode`) defined in `src/contracts/`.

---

## 2. Page Specifications & Client State Machines

### 2.1 Landing & Auth (`/`)
- **State**: `unauthenticated` | `authenticating` | `authenticated`.
- **Interactions**: Tab toggle between "Sign In" and "Sign Up". Selection of `teacher` vs `student` role during registration.
- **Post-Auth Routing**: Teachers redirect to `/professor/dashboard`; students redirect to their first enrolled course `/student/[studentId]` or an enrollment prompt.

### 2.2 Teacher Lecture Dashboard (`/professor/dashboard`)
- **State**: `idle` | `lecture_live` | `poll_draft` | `poll_active` | `poll_closed`.
- **Sub-components**:
  - `LectureControls`: Start/End lecture buttons, lecture elapsed timer.
  - `LiveTranscriptFeed`: Real-time streaming chunks with detected concept tags.
  - `FormativePollPanel`: "Generate Poll" button, draft editor, "Activate Poll", live response counter, "Close Poll".
  - `ClassHeatmap`: Concept breakdown showing student distribution across `gray`, `red`, `yellow`, `green` bands.
  - `InterventionDrawer`: On-demand AI recommendations for emerging lecture misconceptions.

### 2.3 Student Lecture & Graph View (`/student/[studentId]`)
- **State**: `connected` | `reconnecting` | `disconnected`.
- **Sub-components**:
  - `KnowledgeGraphVisualizer`: Interactive force-directed canvas displaying personal concept mastery.
  - `LiveLectureSidebar`: Real-time transcript feed and active lecture status.
  - `ActivePollModal`: Slides up smoothly using `motion/react` when `poll:new-question` is received; accepts free-form text response and displays server evaluation feedback.
  - `ActiveConceptBadge`: Pulses gently when the lecturer actively discusses that concept.

---

## 3. Knowledge Graph Visualization (D3-force)

The knowledge graph renders prerequisite relationships and student confidence:

### 3.1 Layout & Physics Simulation
- **Hierarchical Levels**: Concepts are assigned a topological depth level based on their longest incoming prerequisite path:
  $$\text{level}(v) = \begin{cases} 0 & \text{if } \text{in\_degree}(v) = 0 \\ \max_{(u, v) \in E} \text{level}(u) + 1 & \text{otherwise} \end{cases}$$
- **Precomputed Stability**: The D3-force simulation runs a deterministic baseline of **300 ticks** off-screen before initial render, preventing visual jitter when the page mounts.
- **Coordinates & Viewport**: Nodes are placed with vertical layers corresponding to topological levels and horizontal force repulsion (`d3.forceManyBody().strength(-400)`).

### 3.2 Visual Styling & Mastery Colors
Nodes are rendered as SVG elements with high-contrast text labels:
- `gray`: `#9CA3AF` (Confidence $0.0$)
- `red`: `#EF4444` (Confidence $0.0 < c < 0.40$)
- `yellow`: `#F59E0B` (Confidence $0.40 \le c < 0.70$)
- `green`: `#10B981` (Confidence $c \ge 0.70$)
- **Active Concept Overlay**: When a concept is detected in live lecture speech, a glowing amber ring pulses around the node regardless of its mastery color.
- **Ancestor Highlighting**: Clicking a concept node highlights all transitive incoming prerequisite paths with illuminated connecting lines and dims unrelated graph clusters.

---

## 4. Accessibility & Responsive Design

1. **Text Alternatives to Mastery Colors**: Every concept node and heatmap bar provides explicit textual status badges (e.g., `"Mastered (85%)"`, `"Needs Practice (20%)"`), ensuring accessibility for color-blind users (WCAG 2.1 AA).
2. **Keyboard Navigation**:
   - `Tab` / `Shift+Tab`: Focuses sequentially through concept nodes ordered by topological prerequisite level.
   - `Enter` / `Space`: Opens concept detail drawer or triggers ancestor path highlighting.
   - `Escape`: Closes drawers, modals, and active ancestor selections.
3. **Reduced Motion Support**:
   - All animations via `motion/react` respect `prefers-reduced-motion: reduce`. When active, physics spring animations and pulsing overlays degrade to instantaneous state cuts.
4. **Responsive Layout**:
   - Desktop ($\ge 1024\text{px}$): Dual-pane layout (Graph canvas left $65\%$, live sidebar right $35\%$).
   - Mobile / Tablet ($< 1024\text{px}$): Tabbed view toggle between "Knowledge Graph" and "Lecture Stream".
