# Frontend & Client Architecture: Next.js 16 & React 19

This document specifies the user interface architecture, route hierarchy, feature component mounting, D3-force knowledge graph visualization, warm design tokens, SVG companion mascot (Spark), student progression panels, instructor Class Sky, and accessibility standards.

---

## 1. Route Hierarchy & Component Ownership

Route shells are authored and maintained by **Lane D** within `src/app/`. Autonomous feature views authored by **Lane C** and **Lane B** are mounted inside these route shells via typed exported components.

```text
src/app/
├── layout.tsx                                      # Global HTML shell, warm theme tokens, toast provider
├── page.tsx                                        # Route: / (Landing & Auth)
├── professor/
│   ├── dashboard/page.tsx                          # Route: /professor/dashboard (Lecture controls, Class Sky, Roster)
│   └── upload/page.tsx                             # Route: /professor/upload (Syllabus ingestion & graph preview)
└── student/
    └── [studentId]/
        ├── page.tsx                                # Route: /student/[studentId] (Student Star Graph, Quests, Mascot)
        ├── tutor/page.tsx                          # Route: /student/[studentId]/tutor (Mounts TutorFeature)
        ├── study-group/page.tsx                    # Route: /student/[studentId]/study-group (Mounts StudyGroupFeature)
        ├── summaries/page.tsx                      # Route: /student/[studentId]/summaries (Lecture summaries)
        └── concepts/
            └── [conceptId]/page.tsx                # Route: /student/[studentId]/concepts/[conceptId] (Mounts LearningFeature)
```

### 1.1 Feature Component Contracts
Lane C and Lane B export self-contained feature views from `src/features/`:
1. `TutorFeature` (Lane C): Interactive multi-turn Socratic chat interface with KaTeX math rendering.
2. `LearningFeature` (Lane C): Comprehensive Markdown concept learning guide, 5-question practice quiz, and cited Perplexity academic search.
3. `EncounterFeature` (Lane C): Inline practice encounter modal/drawer wrapping 5-question quizzes with Spark mascot reactions, three-tier sequential hints (Nudge, Bigger hint, Walkthrough), and XP reward card.
4. `StudyGroupFeature` (Lane C / Lane B): Consensual peer pool opt-in, mutual availability picker, private peer chat, bilateral Zoom meeting display, and collaborative Party quest progress (1–3 shared concepts).

All feature props accept standard DTOs (`ActorContext`, `Student`, `ConceptNode`, `DailyQuestDTO`, `EncounterDTO`, `GameSummaryDTO`) defined in `src/contracts/`.

---

## 2. Design Tokens & Visual Palette

The application uses a warm, editorial, non-distracting visual palette that replaces cold default dark themes with comforting warm paper and cream tones while strictly preserving WCAG 2.1 AA accessibility contrast.

### 2.1 Canonical Token Palette Table

| Token Name | Hex Code | Role & Usage | Measured Contrast Against Paper (`#faf6ee`) |
|---|---|---|---|
| `paper` | `#faf6ee` | Canvas root background, page surface | 1.0:1 (Base background) |
| `panel` | `#fffdf8` | Elevated cards, modal dialogs, drawers | 1.05:1 (Subtle elevation) |
| `cream` | `#f4e9d7` | Star node unassessed fill, inactive tabs | 1.15:1 |
| `cream-deep` | `#ecdcc0` | Hover states, table headers, borders | 1.3:1 |
| `line` | `#e6d8bd` | Decorative dividers, graph prerequisite edges | 1.4:1 (Non-text decorative) |
| `ink` | `#2b2a2e` | Primary body text, headings, dark icons | **13.2:1** (Passes WCAG AAA) |
| `charcoal` | `#3a3a3d` | Secondary body text, active borders | **10.4:1** (Passes WCAG AAA) |
| `muted` | `#5f5b54` | Captions, timestamps, disabled indicators | **4.6:1** (Passes WCAG AA body text) |
| `orange` | `#ed793c` | Mascot accent, button primary, star glow | 2.5:1 (Non-text decorative / UI elements) |
| `orange-deep`| `#c85c22` | Button hover, active tab indicator | 3.6:1 (Large text / UI boundary $\ge 3:1$) |
| `orange-text`| `#a9481a` | High-contrast accent text, link text | **4.6:1** (Passes WCAG AA text $\ge 4.5:1$) |
| `yellow` | `#f4bc55` | Lit star developing fill, streak flame | 1.6:1 (Graphic fill) |
| `yellow-deep`| `#cf951f` | Developing band borders, warning accents | 2.3:1 (Graphic boundary) |
| `yellow-tint`| `#fbeac2` | Warning alert background, hint pill bg | 1.1:1 |
| `good` | `#2b7f55` | Shining star mastered fill, correct badge | **4.8:1** (Passes WCAG AA text/icon) |
| `good-tint` | `#dff1e5` | Correct answer card background | 1.15:1 |
| `bad` | `#b0384a` | Dim star needs-practice fill, wrong badge| **4.6:1** (Passes WCAG AA text/icon) |
| `bad-tint` | `#f8e0e3` | Incorrect answer card background | 1.2:1 |

### 2.2 Contrast & Accessibility Invariants
1. **Body Text Contrast**: All body text MUST use `ink` or `charcoal` on `paper`/`panel` surfaces ($\ge 10:1$). Auxiliary captions use `muted` ($\ge 4.5:1$). Accent text MUST use `orange-text` (`#a9481a`), never raw `orange` (`#ed793c`), ensuring $\ge 4.5:1$ compliance.
2. **Interactive Boundaries & Focus Rings**: Because decorative `line` (`#e6d8bd`) is subtle, all keyboard focus rings, active button borders, and input strokes use `charcoal` or `orange-deep` with measured $\ge 3:1$ contrast against neighboring surfaces.
3. **No Unprovided Dark Palette**: The platform renders on the warm light paper palette. Default dark canvas styles from earlier drafts are replaced with this warm paper palette.
4. **Non-Color Semantic Indicators**: Star nodes and cards MUST never rely solely on color. Every star and badge displays explicit text alternatives (e.g., "Dim / Needs practice (20%)", "Shining / Mastered (85%)") and distinct geometric stroke/fill patterns.

---

## 3. Knowledge Graph Visualization (D3-force)

The knowledge graph visualizes course curriculum concepts as interactive stars positioned by D3-force simulation. The layout algorithm strictly preserves dynamic physics; static transit-map grid engines are rejected.

### 3.1 Layout & Physics Simulation Invariants
1. **Topological Depth Stratification**: Concepts are stratified into hierarchical levels based on their longest incoming prerequisite path:
   $$\text{level}(v) = \begin{cases} 0 & \text{if } \text{in\_degree}(v) = 0 \\ \max_{(u, v) \in E} \text{level}(u) + 1 & \text{otherwise} \end{cases}$$
2. **Force Simulation Configuration**:
   - `d3.forceManyBody().strength(-400)` provides node-to-node repulsion.
   - `d3.forceLink(edges).id(d => d.id).distance(80).strength(0.7)` preserves prerequisite connection lengths.
   - `d3.forceY(d => d.level * 120).strength(0.8)` preserves vertical prerequisite hierarchy.
   - `d3.forceX(width / 2).strength(0.1)` gently centers the graph.
3. **Precomputed Off-Screen Stability**: The D3-force simulation runs **300 ticks** off-screen before initial paint. This guarantees zero visual jitter or node sliding when the page mounts.
4. **Category Track Annotations**: Concept category groupings ("tracks") may annotate graph regions or group node backgrounds, but MUST NOT constrain nodes to static transit lanes.

### 3.2 Dynamic Star Vessel Rendering
Each concept node renders as an SVG star vessel (radius 24px) at D3-computed coordinates `(x, y)`:
1. **Vertical Confidence Fill**: Confidence $c \in [0.0, 1.0]$ is rendered via an SVG `<clipPath>` defining a vertical rectangle from bottom to top:
   $$\text{clipHeight} = \text{round}(48 \times c) \text{ px}$$
   $$\text{clipY} = y + 24 - \text{clipHeight}$$
2. **Mastery Band Mapping (INV-XP01)**:
   - `gray` ($c = 0.0$): Fill `cream` (`#f4e9d7`), stroke `line` (`#e6d8bd`). Text: "Unassessed".
   - `red` ($0.0 < c < 0.40$): Fill `bad` (`#b0384a`), stroke `bad`. Text: "Dim (Needs practice)".
   - `yellow` ($0.40 \le c < 0.70$): Fill `yellow` (`#f4bc55`), stroke `yellow-deep` (`#cf951f`). Text: "Lit (Developing)".
   - `green` ($c \ge 0.70$): Fill `good` (`#2b7f55`), stroke `good`. Text: "Shining (Mastered)".
3. **Active Concept Ring**: When a concept is actively detected in live lecture speech, a glowing amber ring pulses around the node (`stroke: #ed793c`, `stroke-width: 3px`) with an animation loop.
4. **Ancestor Path Highlighting**: Clicking a star highlights all incoming prerequisite edges backward to foundational roots with bold `orange-text` strokes and dims non-ancestor nodes to 25% opacity.

---

## 4. Companion Mascot: Spark

Spark is an embedded reactive SVG companion mascot guiding learners with encouraging, adult coaching without shame or solution leakage.

### 4.1 SVG Anatomy & Dimensions
- **Dimensions**: 132px × 132px on student home and dashboard; 84px × 84px inside the Encounter panel; 32px × 32px compact header avatar.
- **Anatomy**:
  - `Body`: Soft rounded teardrop flame shape with subtle radial gradient (`#f4bc55` core to `#ed793c` edge).
  - `Face`: Expressive oval eyes and mouth path capable of morphing between mood shapes.
  - `Corona / Rays`: Radiating energy rays that scale and glow based on form evolution.
  - `Shadow`: Grounded elliptical drop shadow with subtle vertical hover oscillation.

### 4.2 Mood Expressions & Reactions
| Mood State | Trigger Condition | Visual Appearance | Voice / Copy Style |
|---|---|---|---|
| `calm` | Default idle, navigating stars | Gentle vertical hover ($\pm 4\text{px}$, 3s ease-in-out), relaxed smile | Friendly, calm, observational |
| `think` | Practice quiz open, hint requested, evaluating | Slight head tilt ($5^\circ$), eyes narrowed upward, pulsing brow | Encouraging, contemplative, guiding |
| `cheer` | Correct quiz answer, quest cleared, streak incremented | Upward bounce hop (640ms), wide smiling eyes, sparkle burst | Enthusiastic, congratulatory, specific |
| `oops` | Incorrect quiz answer submitted | Gentle empathetic shrug, soft eyes, no frown | Warm, non-shaming, growth-oriented |
| `sleepy` | Idle for $> 30\text{ seconds}$ without mouse/keyboard input | Slow eyelid droop, soft breathing rhythm | Soft, ready whenever the student returns |

### 4.3 Evolutionary Forms (INV-XP08)
Mascot evolution derives strictly from whole-course sky brightness (average student confidence):
1. **Ember** ($0.0 \le \text{sky} < 0.25$): Small soft flame, subtle embers, curious eyes.
2. **Spark** ($0.25 \le \text{sky} < 0.55$): Energetic flame, crisp corona rays, confident posture.
3. **Glow** ($0.55 \le \text{sky} < 0.75$): Luminous radiance, golden corona, warm sparkles.
4. **Nova** ($\text{sky} \ge 0.75$): Brilliant celestial form, crown of light rays, triumphant glow.

### 4.4 Motion & Reduced-Motion Rules
- Ambient movement uses GPU-accelerated CSS `transform: translateY()` and `opacity`.
- JavaScript animations via `motion/react` respect `prefers-reduced-motion: reduce`. When active, hover oscillations, bounce hops, and particle bursts are disabled; mascot updates use instantaneous SVG path cuts.

---

## 5. Student Progression & Habit Panels

The student interface provides focused panels for daily habits, review pressure, and practice encounters without clutter.

### 5.1 Game Summary Pill
Positioned prominently in the student header:
- **XP Counter**: Total earned XP from append-only ledger (e.g., `⚡ 420 XP`).
- **Streak Flame**: Consecutive active UTC quest days (e.g., `🔥 4 Days`).
- **Sky Brightness**: Course mastery percentage (`☀️ 64% Sky`).
- **Spark Avatar**: Current mascot form thumbnail (`Glow`).

### 5.2 Daily Quest Panel
Surfaces the student's persistent 0–3 ready review concepts for the current UTC date:
- Item list displaying concept label, current confidence bar, and review state (`overdue` vs `unreviewed`).
- Completed items display a strikethrough and green checkmark.
- Completion reward banner: `+25 XP Daily Bonus` awarded on clearing the nonempty queue.
- Empty State: When candidate queue is 0, renders "Clear Skies: All prerequisites mastered and current on review." (0 XP awarded, streak untouched).

### 5.3 Eclipse Review-Pressure Diagnostic Panel
Visual indicator of exam review pressure:
- **Strength Meter**: Large radial or linear dial displaying $\text{strength} \in [0, 100]\%$.
- **Target Concepts**: Pills for up to 3 lowest-confidence ready concepts ($c < 0.70$) contributing to pressure.
- **Exam Countdown**: If `courses.exam_at` is set, displays formatted countdown (e.g., `"Midterm in 6 days, 4 hours"`).
- **Clear Skies State**: When all ready concepts have $c \ge 0.70$, displays 0% pressure with a sunny horizon graphic.

### 5.4 Practice Encounter Inline Panel
Surfaces a focused five-question quiz inside an accessible slide-over panel or modal:
- **Header**: Concept title, question index (`Question 2 of 5`), Mascot Spark in `think` mood.
- **Question Card**: Formatted prompt with KaTeX math rendering, four radio options.
- **Hint Drawer**:
  - `Hint 1 (Nudge)`: Subtle conceptual reminder.
  - `Hint 2 (Bigger hint)`: Deeper reasoning step.
  - `Hint 3 (Walkthrough)`: Methodological walkthrough without revealing the answer option.
- **Submission Feedback Card**: Displays score (e.g., `4/5 Correct`), confidence change ($+0.15$), XP earned (discounted by hints used), Mascot in `cheer` or `oops` mood, and question-by-question explanations.

---

## 6. Instructor Class Sky & Effort Roster

The instructor dashboard at `/professor/dashboard` provides the **Class Sky** tab, giving instructors macro-level insight into class understanding and effort without violating student privacy.

### 6.1 Class Sky Aggregate Graph
- Visualizes the full knowledge graph where each concept star is colored by class mean confidence $\bar{c}(v)$.
- **Taught Indicator**: Concepts discussed in lecture (evidenced by committed transcript chunks) are marked with a book icon.
- **Attention Rings**: Taught concepts where class mean confidence is below $0.40$ (`red` band) render a prominent pulsing crimson attention ring, signaling urgent need for lecture recap or formative poll intervention.

### 6.2 Effort vs. Mastery Roster Quadrant
A sortable table and 2D scatter matrix displaying individual student learning states:
- **Columns**: Student Name, Enrolled Date, Total XP (Effort), Mean Course Confidence (Mastery), Effort Percentile, Mastery Percentile, Intervention Flag.
- **Intervention Flag (`high_effort_low_mastery`)**:
  - Automatically flagged when student XP percentile $\ge 75\%$ AND confidence percentile $\le 40\%$.
  - Indicates a hardworking student who is struggling with core concepts and needs direct instructor help or peer tutoring.
- **Privacy Enforcement**: This quadrant and XP percentiles are strictly instructor-facing. No student-facing leaderboards or public XP rankings exist anywhere in the application.

---

## 7. Accessibility, Responsive Breakpoints & Testing

### 7.1 Accessibility Standards (WCAG 2.1 AA)
1. **Keyboard Traversal**:
   - `Tab` / `Shift+Tab`: Focuses sequentially through stars ordered topologically by prerequisite depth.
   - `Enter` / `Space`: Selects a concept node, opens the detail drawer, or toggles ancestor illumination.
   - `Escape`: Closes drawers, modal encounters, and active selections.
2. **Screen Reader Live Announcements**:
   - ARIA live region (`aria-live="polite"`) announces:
     - Socket concept detection during live lectures: `"Concept Backpropagation detected in lecture."`
     - Poll activation: `"New formative poll activated by instructor."`
     - Hint reveal: `"Hint level 1 revealed."`
     - Encounter completion: `"Encounter submitted. Score: 4 out of 5. Confidence updated to 35 percent. 88 XP awarded."`
3. **Focus Indicators**: All focusable elements have a high-contrast 2px solid ring (`outline: 2px solid #2b2a2e`, `outline-offset: 2px`) meeting the $\ge 3:1$ non-text contrast criterion.

### 7.2 Responsive Breakpoints
- **Mobile (< 768px)**:
  - Tabbed segmented control toggles between "Star Graph" and "Lecture Stream" / "Daily Quests".
  - Knowledge graph supports single-finger drag pan and pinch-zoom.
- **Tablet (768px – 1023px)**:
  - Stacked layout with collapsible quest drawer and full-width star canvas.
- **Desktop (1024px – 1359px)**:
  - Dual-pane layout: 65% interactive star graph canvas, 35% live sidebar (transcript / quest panel / peer chat).
- **Wide Desktop ($\ge 1360px$)**:
  - Three-column layout: 20% quest & mascot rail, 55% graph canvas, 25% live stream & intervention rail.
