# Spark Design Doc

Status: v2 prototype built, design direction agreed, not yet implemented as a product.
Companion docs: `SPARK_TECHNICAL.md` (architecture and data), `spark.html` (clickable prototype, single file).
Source material: the Preree repo (`jasonyi33/prereq`), its Devpost write-up and demo transcript, and the design conversation that produced Spark.

How to use this doc: it is written so an agent or a new teammate can build, extend or review Spark without asking what it is supposed to feel like. Sections 1 to 4 say what and why. Sections 5 to 8 say how it looks, moves and sounds. Section 9 is the review checklist. When this doc and the prototype disagree, the doc is the intent and the prototype is a draft.

---

## 1. Vision and positioning

**Spark turns a course into a map of stars that only light up when you can prove you understand them.**

Spark is a gamified rebuild of Preree (TreeHacks 2026, Zoom Education track winner), the lecture-to-knowledge-graph learning co-pilot. Preree shows a student which prerequisites they are missing. Spark keeps that engine and adds the reason to come back: progression, a mascot tutor, daily practice, and a shared sense of a class climbing together.

**Thesis.** A prerequisite map where stars fill with light as mastery rises, and a mascot (Spark) who walks to the star you pick and reacts to every answer. Light comes only from demonstrated understanding. Effort is rewarded separately and never disguised as understanding.

### How Spark differs from Preree

| | Preree | Spark |
| --- | --- | --- |
| Core metaphor | Knowledge graph, concepts as nodes | Quest line, concepts as stars that fill with light |
| Student motivation | Fix gaps before they compound | Keep the streak, light the dimmest star, beat the Eclipse (midterm) |
| Guide | None (a tool) | Spark, a reactive mascot tutor |
| Feedback loop | Poll answers recolor the graph | Every answer changes the star, Spark's mood, XP and possibly unlocks the next star |
| Between lectures | Study group matching, tutoring chat | Daily Quest, Eclipse, party quests, plus study group matching |
| Professor view | Concept heatmap, polls, interventions | Same, restated as the Class Sky, with effort (XP) and mastery shown separately |

### Positioning in one sentence

Spark rewards demonstrated mastery, not logins. A product that hands out points for opening the app could not truthfully say this.

### Product principles

1. **Light only comes from demonstrated mastery.** A star fills from correct retrieval answers, including ones days later. Reading, watching or tapping never fills it.
2. **The map is the product.** Game elements annotate the map and never bury it.
3. **Spark reacts and never scolds.** Wrong answers get warmth and a next step, not a penalty animation.
4. **Effort and understanding are separate numbers.** XP measures effort. Mastery measures understanding. Professors see both side by side.
5. **Medium game volume.** Spark and the Daily Quest live in the side panel. The map and panels stay calm enough that a college student in a 300-seat lecture does not feel talked down to.
6. **Honest data.** Any sample number in a prototype is labeled as sample data. No fabricated claims.

### What Spark refuses to be

- A children's game. The mascot is a calm star, not an animal, and the UI is adult: warm paper, charcoal ink, no confetti walls.
- A generic analytics dashboard of equal-size cards.
- A dark neon "night sky" game skin. (Prototype v1 was this and was rejected: it fought the warm palette and Preree's light layout.)
- A points machine that rewards time spent over understanding.

---

## 2. Users and jobs to be done

Spark serves two people in the same lecture hall: the student who is quietly lost and the professor who cannot see it. Both are inherited from Preree's problem statement (300+ seat lectures, cumulative subjects, no real-time signal of who is falling behind).

### Primary: the student

A college student in a large lecture course (the demo course is CS229 Machine Learning) who loses track of prerequisites as the course compounds.

| Moment | Job to be done | What Spark gives them |
| --- | --- | --- |
| During lecture | "Tell me when I have just lost the thread." | Live transcript with concepts highlighted, a poll that lands as an Encounter, Spark standing on the star the professor is on |
| Right after lecture | "Which stars did today just dim?" | Fading and dim stars surface in the Daily Quest |
| Between lectures | "Give me ten honest minutes that actually help." | Daily Quest of the three dimmest reachable stars, short Encounters with tiered hints |
| Before an exam | "What should I fix first?" | The Eclipse shows how much of the dimmest chain is left, and each fix pushes it back |
| Stuck | "Get me a human who knows this." | Study party matching: a classmate strong where you are dim and the reverse |

### Secondary: the professor

| Moment | Job to be done | What Spark gives them |
| --- | --- | --- |
| Mid-lecture | "Is the room with me?" | Class Sky: the same map showing class averages, orange ring on stars that need a reteach |
| Mid-lecture | "Check understanding now, on the right concept." | Generate a poll for the dimmest recent concept, send it, watch the distribution fill in live |
| After lecture | "What do I do about it?" | Suggestions tab with concrete reteach ideas per dim star |
| Over the term | "Who is putting in effort but not getting it?" | Students tab with XP and mastery side by side, flagged "High effort, low mastery" |

### Why a game layer for adults

Early feedback pushed back on three assumptions, and the design answers each:

- **"Levels are linear but knowledge isn't."** Concepts build on each other, so the levels are a prerequisite graph. A star unlocks only when every prerequisite sits at mastery 60 or above. There is no single track to walk, just a structure to light.
- **"A cartoon bird feels childish."** The mascot is a calm, non-animal star with a quiet face. Game volume is medium and lives in the side panel.
- **"XP can reward the wrong thing."** XP is real and visible (professors see who put in more), but it never fills a star. Mastery is the only thing that lights one.

---

## 3. Game model

### 3.1 Vocabulary

| Term | Meaning | Maps to in Preree |
| --- | --- | --- |
| Quest line | A course (CS229) | `courses` |
| Star | One concept | `concept_nodes` |
| Lane | A track of related stars (Calculus, Probability, Linear Algebra, Core ML) | `concept_nodes.category` |
| Gate star | A star many others depend on (extra ring) | High importance score from graph in-degree |
| Mastery | 0 to 100, understanding of a star | `student_mastery.confidence` x 100 |
| XP | Effort points, never fills a star | New |
| Encounter | A short question set on one star | Poll question or concept quiz |
| Daily Quest | The three dimmest reachable stars, one session | New |
| Eclipse | The boss that feeds on your dimmest stars before an exam | New |
| Party | A study group matched on complementary strengths | `study_group_pool` and matches |
| Class Sky | The professor's map of class averages | Heatmap |
| Spark form | The mascot's growth stage, driven by sky brightness | New |

### 3.2 The prerequisite map

- Stars are nodes, prerequisites are edges, and edges run left to right within a lane then into the Core ML lane.
- **Unlock rule:** a star is locked while any prerequisite has mastery below 60. Locked stars are dashed, show a small lock, and say what they need.
- A star with no prerequisites is always open.
- **Gate stars** (Gradient Descent, Linear Regression in the sample) get a dotted outer ring because many downstream stars wait on them.
- Selecting a star highlights its ancestor chain and dims everything else (this is Preree's selected-node behavior, kept).

### 3.3 Star states

| State | Mastery | Fill | Outline | Meaning |
| --- | --- | --- | --- | --- |
| Locked | n/a | empty, dashed | grey-tan dashed | A prerequisite is below 60 |
| Dim | 0 to 59 | partial, from the bottom | tan | Open but not yet understood |
| Lit | 60 to 84 | yellow fill | amber | Understood, still worth reviewing |
| Shining | 85 to 100 | yellow fill plus eight ray ticks that slowly twinkle | orange | Solid |

Fill level literally tracks mastery: the star is a vessel that fills from the bottom. This is the signature visual of the product (see section 5.6).

**Fading:** a lit or dim star that has gone unpracticed for days gets a slow flicker and a "Fading" tag. Fading is what the Daily Quest targets first.

### 3.4 XP versus mastery

| | XP | Mastery |
| --- | --- | --- |
| Measures | Effort | Understanding |
| Earned by | Finishing Encounters, streak days, party quests | Correct retrieval answers, weighted by hints used and mistakes |
| Fills stars | Never | Always |
| Shown to student | Header chip, Encounter feedback | Star fill, percent, state tag |
| Shown to professor | Students tab, with a flag when high XP pairs with low mastery | Class Sky, heatmap, students tab |
| Can go down | No | Yes, via decay |

The professor's "High effort, low mastery" flag exists to answer "who is trying but not getting it", which is the useful half of the incentive argument.

### 3.5 Daily Quest

- The three dimmest stars the student can actually open (locked stars are excluded), fading stars first.
- Clearing all three in a day increases the streak by one. The streak never punishes a missed day with shame copy; it just resets quietly.
- The Spark tab shows the queue, each row with mastery and a tag (Dim, Fading, Done), and a primary "Start Daily Quest" button.
- Quest queues auto-advance: a correct answer shows the reward panel, "Next star" loads the next Encounter.

### 3.6 The Eclipse (boss)

A shadow that feeds on your three dimmest stars in the run-up to an exam. Its strength is the average gap between those three stars and the Shining threshold (85), shown as an orange bar. Every correct answer on a feeding star pushes it back. At zero it is gone and Spark says so. Presented as a calm progress element, not a monster fight. No health bars with skulls, no combat copy.

### 3.7 Parties

A party is a short, scheduled study session with one or two classmates matched on complementary strengths: each person is strong on stars the other is dim on.

- Pick stars to study (defaults to your dimmest), find matches, see a fit percentage, see who is strong where, invite, pick a time slot.
- A party quest is a shared goal (for example clear Gradient Descent together for bonus XP).
- Fit is the average absolute mastery difference across the chosen stars, which is the same complementarity measure Preree uses.
- Parties are opt-in and never expose a student's full mastery map to another student, only the chosen stars (see technical doc, privacy).

### 3.8 Spark's growth

Spark's form follows the average mastery across the whole map ("sky brightness"), not XP.

| Form | Threshold (average mastery) | Look |
| --- | --- | --- |
| Ember | 0 | Smaller, paler star, sleepy |
| Spark | 25 | Full color star |
| Glow | 55 | Slowly rotating ray ring behind the body |
| Nova | 75 | Ray ring plus two tiny orbiting stars |

Evolving triggers a spin-hop with a sparkle burst. Growth ties the mascot to real learning, which is the whole honesty claim of the product.

### 3.9 Professor loop (Class Sky)

- The same map, but each star shows the class average and a state derived from it (solid 75 and up, mixed 50 to 74, dim under 50, upcoming for untaught stars).
- Stars under 50 that have been taught get an orange attention ring.
- Selecting a star opens a class detail tab with a "Push an Encounter" action.
- The Poll tab generates one question for the class's weakest recent star, sends it, and shows a live distribution (correct, partial, wrong). Closing the poll moves the class average.
- The Students tab sorts by XP or mastery and flags mismatches. The Suggestions tab gives reteach ideas for the dimmest stars.

---

## 4. Spark the mascot

### 4.1 Identity

Spark is a rounded five-point star in yellow-to-orange, with a calm friendly face (two eyes with highlights, a small smile) and two short idea ticks above its head. It is not an animal and not a person. It is a small light that is learning with you.

- Name: **Spark** (also the product name).
- Source asset: the user-supplied "Rounded Spark" illustration. The SVG in the prototype redraws it with a rounded stroke-joined star path so it can animate.
- Personality: warm, patient, a little dry. A study partner, not a cheerleader.

### 4.2 Anatomy (for implementers)

- **Body:** star path (10 points, outer radius 70, inner 40 in a 200 box) filled with a vertical gradient (`#f8cb62` to `#f4a949` to `#ee7d3b`) and stroked in the same gradient with a wide round-joined stroke to round the corners.
- **Eyes:** white ellipses with a dark pupil and a small white catch-light. Pupils are a separate group so they can move.
- **Mouth:** a single stroke that swaps per mood.
- **Idea ticks:** two short amber strokes above the head that flicker occasionally.
- **Shadow:** a soft ellipse on the ground that stays put while the body hops.
- **Aura:** ray ring and orbiting stars, only at Glow and Nova.

### 4.3 Moods

| Mood | Eyes | Mouth | Extras | Used when |
| --- | --- | --- | --- | --- |
| Calm | open, tracking cursor | small smile | idea ticks | default |
| Think | open, glancing up-left, head tilted | small "o" | tilt | selecting a locked star, asking for a hint, a poll arrives |
| Cheer | closed happy arcs | open smile with tongue, blush | sparkles on hop | correct answer, Daily Quest cleared |
| Oops | wide, small pupils | wavy mouth, raised brows | quick shake | wrong answer |
| Sleepy | closed down-arcs | small "o" | floating "z" | 30 seconds idle on the map |

### 4.4 Behavior rules (Duolingo-style, adult tone)

1. **Always reactive.** Every answer, hint, selection and idle timeout changes Spark's mood or position within 150 ms.
2. **Always present, never in the way.** Spark lives in the side panel and as a small token on the map. It never covers content or blocks input.
3. **Never scolds.** Wrong-answer lines are neutral or warm ("Close. Want a nudge?", "Mistakes are how stars fill up."). No shame, no counters of failures.
4. **Looks at what you are doing.** Pupils follow the cursor everywhere (within a small range). It blinks on an irregular timer and breathes continuously.
5. **Walks to the star you pick.** The map token hops along an arc to the selected star (about 640 ms) with squash and stretch.
6. **Nudges, once.** After about 30 idle seconds Spark falls asleep and the speech bubble reminds you about the Daily Quest. Any interaction wakes it with a small hop. It does not escalate.
7. **Quiet in focus.** During an Encounter the mascot is smaller and its bubble only carries short reactions.

### 4.5 Reactions

| Trigger | Animation | Mood | Line pattern |
| --- | --- | --- | --- |
| Select a star | hop (arc), side panel bubble updates | calm (think if locked) | "{Star} is dim. One Encounter will help." |
| Correct answer, no hints | hop with sparkle burst | cheer, 2.6 s | "That is it. No hints needed." |
| Correct answer, hints used | hop with sparkle burst | cheer | "That is it. Nice work." |
| Wrong answer | shake, 500 ms | oops, 1.6 s | "Close. Want a nudge?" |
| Take a hint | head tilt | think, 1.8 s | "Here is a nudge." |
| Evolve | spin-hop with sparkles | cheer | "I am evolving!" |
| Daily Quest cleared | hop | cheer | "Daily Quest cleared. Streak is safe at N days." |
| Poll arrives in lecture | tilt, toast | think, 2.4 s | "A poll just went up." |
| Idle 30 s | falls asleep | sleepy | "Psst. Your Daily Quest is waiting." |

### 4.6 Hint tiers

Hints are three escalating levels (Nudge, Bigger hint, Walkthrough). Each hint used lowers the mastery gain and XP for that answer. The copy tells the student this up front ("Fewer hints earn more mastery") so it is a choice, not a trap.

### 4.7 Voice

Short, plain, second person, present tense. Spark says what happened and what is next. No exclamation spam, no emoji, no baby talk. See section 8.

---

## 5. Visual system

### 5.1 Design stance

Spark is an Operate surface (the user is completing a task), so familiarity and clarity outrank expression. Personality lives in the mascot, the star fill, the lane map and motion, not in decoration. The layout deliberately matches Preree.

### 5.2 Palette (pinned by the user)

The brand palette is the "Warm and Energetic" set the user supplied: warm orange, yellow, cream, charcoal, on a light page.

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#faf6ee` | Page background |
| `--panel` | `#fffdf8` | Panel and card surface (second neutral, slightly lighter than paper) |
| `--cream` | `#f4e9d7` | Lanes, speech bubble, hover fill, bar track |
| `--cream-deep` | `#ecdcc0` | Deeper cream for emphasis |
| `--line` | `#e6d8bd` | Borders and dividers |
| `--ink` / `--charcoal` | `#2b2a2e` / `#3a3a3d` | Text and dark buttons |
| `--muted` | `#5f5b54` | Secondary text (meets 4.5:1 on panel) |
| `--orange` | `#ed793c` | Primary action, current selection, Shining state |
| `--orange-deep` | `#c85c22` | Button bottom edge, pressed |
| `--orange-text` | `#a9481a` | Orange used as text (AA on cream) |
| `--yellow` | `#f4bc55` | Light and mastery only (star fill, bars) |
| `--yellow-deep` | `#cf951f` | Lit outline |
| `--yellow-tint` | `#fbeac2` | Hint cards, tags |
| `--good` / `--good-tint` | `#2b7f55` / `#dff1e5` | Correct answer feedback |
| `--bad` / `--bad-tint` | `#b0384a` / `#f8e0e3` | Wrong answer, check-in flag |

**Color rules**

- Orange is for primary actions, the current selection and state indicators. It is not decoration.
- Yellow is for light and mastery only. A yellow thing means "understood".
- Do not use red or green as the star-state signal. (Preree uses red, yellow, green. Spark replaces that with dim, lit and shining so the map reads as one warm family and is friendlier to color-blind users: the signal is fill level and ray ticks, with color as reinforcement.)
- Semantic green and red appear only in answer feedback and flags.
- Never put text on yellow or orange below AA contrast. Use charcoal on yellow and white or charcoal on orange per measured contrast.

### 5.3 Typography

| Role | Face | Notes |
| --- | --- | --- |
| Display (wordmark, headings, question text) | Baloo 2, 600 to 800 | Rounded, friendly, matches the mascot |
| UI and body | Nunito, 400 to 800 | Rounded sans, readable at 13 to 15 px |

Scale (fixed rem-style steps, not fluid): wordmark 30, panel heading 20, encounter question 20, section heading 17, body 14, captions and tags 12 to 13. Body measure stays under about 65 characters. Numerals in tables and bars use tabular figures.

Caution on the pairing: rounded display plus rounded sans can drift childish. The weights stay heavy-but-tidy and the layout stays disciplined to counter that. If a later pass wants a more grown-up voice, the swap to try is a rounded display for the wordmark only and a neutral humanist sans for the UI.

### 5.4 Shape, depth, spacing

- Panels: 1.5 px border in `--line`, radius 16, no shadow. Elevation is declared once, by border, never a border under a wide soft shadow.
- Buttons: radius 12, a 3 px darker bottom edge that compresses to 1.5 px on press. This is the one Duolingo-derived tactile cue and it is used for every button.
- Pills (chips, tags, stat counters): fully rounded, small.
- Lane bands: cream rectangles with radius 16 behind each track of stars.
- Spacing: tight inside groups (6 to 10 px), 16 px panel padding, 18 to 20 px between sections with a 1.5 px divider.
- No gradient text, no glass, no glow halos, no side-stripe borders, no icon tiles.

### 5.5 Iconography

Icons are drawn as inline SVG in one consistent stroke (1.9 px, round caps and joins, 24 px grid): star, bolt, chat, users, flame, close, back, target, idea, list. No emoji, no unicode glyphs as icons.

### 5.6 The map language (signature)

- **Lane bands** name each prerequisite track in small spaced caps at the lane's right edge, like a transit map.
- **Stars** are rounded five-point shapes. Fill rises from the bottom as mastery rises, using a clip rectangle. Outline color encodes state. Shining stars carry eight ray ticks that slowly twinkle in alternating pairs.
- **Edges** are curved connectors: dotted tan when the prerequisite is not met, solid amber once it is, solid orange when part of the selected ancestor chain. Unrelated edges fade to 35 percent while a star is selected.
- **Labels** sit under each star: name in 17 px bold, mastery percent in 14 px muted. Locked stars show "locked".
- **Gate rings:** dotted outer ring for gate stars. Selection ring: dashed orange ring.
- **Floating pill:** bottom center of the map: counts of shining, lit, dim and locked stars. This is Preree's floating mastery pill, restyled.
- **Spark token:** the mascot stands above the current star.

### 5.7 Layout

Preree's operate layout, rebuilt in Spark's vocabulary.

- Header: wordmark, course chip with a live dot, role switch (Student or Professor), Daily Quest button, Find a party button, streak chip, XP chip, avatar.
- Body: two columns. Map about 60 percent, side panel about 40 percent (340 to 470 px). Both are bordered panels of equal height.
- Under about 980 px the columns stack; under that the map scrolls horizontally inside its own container (minimum width 780 px).

---

## 6. Screens and flows

### 6.1 Student home (map plus Spark tab)

First viewport: header, lane map with Spark on the dimmest reachable star, floating pill, and the side panel on the Spark tab.

Spark tab, top to bottom:
1. Hero block: mascot (132 px) and a speech bubble that reflects what the student last did.
2. Form meter: "{Form} form", sky brightness percent, progress to the next form.
3. Daily Quest: three rows (name, mastery, tag), then the "Start Daily Quest" primary button.
4. The Eclipse: strength bar, the three feeding stars as chips, "Fight the Eclipse" button.

### 6.2 Side panel tabs

| Tab | Student | Professor |
| --- | --- | --- |
| 1 | Spark | Students |
| 2 | Encounter (with a dot when a poll is waiting) | Poll |
| 3 | Transcript | Suggestions |
| Dynamic | Selected star (closable) | Selected star (closable) |

Underline tabs, orange underline on the active tab. The dynamic tab shows the selected star's short name and closes with an X. This mirrors Preree's side panel.

### 6.3 Star detail (student)

State tag, track name, blurb, a mastery meter with tick marks at 60 (Lit) and 85 (Shining), a callout that explains the state (locked and what it needs, fading, dim, lit, shining), "Needs" chips (prerequisites with their mastery), "Unlocks" chips, lecture moments (timestamped transcript lines that mention it), and actions: Start Encounter, Find a party.

### 6.4 Encounter

An inline panel, not a modal.

- Progress bar across the Daily Quest queue.
- Star chip and a close button.
- Mascot (84 px) with a one-line reaction bubble.
- Question in display type, answer options as large buttons with a key hint (1, 2, 3 keys work).
- Hint button (0 of 3 used). Hints appear as tinted cards below the options.
- Wrong option turns rose and disabled. Correct option turns green.
- Reward card: mastery gained (before to after), XP, plus any unlock or evolution line, then "Next star" or "Finish".
- No timers, no lives, no countdown pressure.

### 6.5 Live session and Transcript tab

- "Start session" simulates a lecture. Lines appear every few seconds with a timestamp, with concept words highlighted as buttons (yellow underline highlight). Clicking a concept selects the star.
- Each line shows chips for the stars detected in it, colored by the student's current state for that star.
- When a poll line arrives: a toast appears, the Encounter tab gets a dot, Spark tilts and the bubble says a poll went up. Answering updates the star and (in the full product) the professor's Class Sky.

### 6.6 Party flow

1. Pick stars (chips, defaults to your dimmest), "Find my party".
2. Loading skeleton ("Comparing 42 students on ...") with Spark thinking.
3. Matches list: avatar initials, fit percent bar, "Strong in", "You can help with", Invite button.
4. After inviting, choose a time slot. Confirmation line: "Scheduled for ...".
Back button returns to the map.

### 6.7 Professor view (Class Sky)

- Same map with class averages ("86% avg"), state counts in the pill (solid, mixed, dim, upcoming) and attention rings.
- Students tab: sort chips (XP, Mastery), per-student bars, flags.
- Poll tab: weakest three stars as chips, Generate question, Send to class, live distribution (stacked bar plus counts), Close poll, result callout.
- Suggestions tab: reteach idea for each of the two dimmest stars.

### 6.8 Empty, loading, error and edge states

| State | Treatment |
| --- | --- |
| No Encounter running | Mascot, one line on what Encounters are, a "Start Daily Quest" button |
| No transcript yet | One line that tells the student what Start session does |
| Party search | Two skeleton rows with a shimmer, no spinner |
| No matches found | Spark says so plainly and offers to widen the star selection or try later |
| Locked star | Disabled "Locked" button plus the exact prerequisites to light |
| Poll waiting | Dot on tab plus a banner in the Encounter tab |
| Network or AI failure | Say what failed and the fallback ("We could not check that answer. It was saved and your professor can review it.") never a stack trace |

---

## 7. Motion and animation spec

Principle: **motion conveys state, not decoration.** Spark is the one place with personality in motion. Everything else is quick and quiet.

### 7.1 Timings and easing

| Class | Duration | Easing |
| --- | --- | --- |
| Hover, focus, press | 160 ms | ease-out |
| Panel content changes | 200 to 250 ms | ease-out |
| Progress bars | 500 to 600 ms | ease-out |
| Star fill change | 700 ms pop (scale .7 to 1.18 to 1) | ease-out |
| Unlock ping | 1.2 s, twice | ease-out, ring scales .6 to 2.1 and fades |
| Spark hop between stars | 640 ms | cubic-bezier(.3,.7,.35,1) with an arc and squash and stretch |
| Mascot hop reaction | 1.15 s | ease-out, two bounces |
| Mascot shake | 500 ms | ease-out, decaying angle |
| Mascot spin-hop (evolve) | 1.0 s | ease-in-out |
| Sparkle burst | 850 ms, 8 particles | ease-out |
| Breathing | 3.8 s loop, 2.5 percent | ease-in-out |
| Blink | 5.6 s loop, closes at 92 to 95 percent | n/a |
| Ray twinkle | 2.6 s loop, alternating | ease-in-out |

### 7.2 The signature moments (earn these, do not add more)

1. **Spark walks to the star you pick.** The token arcs across the map and squashes on landing.
2. **A correct answer.** The star fills with a pop, the mascot hops with sparkles, any newly unlocked star pings twice.
3. **Evolving.** Spin-hop with a larger sparkle burst, and the form line updates.
4. **A wrong answer.** A short shake, Spark's eyes go wide, then it returns to calm. No red flash.
5. **Idle.** Spark falls asleep with a floating z and wakes with a small hop.

### 7.3 Ambient motion (always on, very low amplitude)

Breathing, blinking, idea-tick flicker, shining-star ray twinkle, fading-star flicker, live-dot pulse. Cursor-following pupils update on pointer move through `requestAnimationFrame` and ease for about 140 ms.

### 7.4 Reduced motion

`prefers-reduced-motion: reduce` turns off every animation and transition, including the hop-to-star (the token just moves). State changes are still conveyed through fill, color, text and tags, so nothing is lost.

### 7.5 What not to animate

Page load sequences, section entrances, anything that delays input, anything that repeats at a pace that pulls the eye away from a question being read.

---

## 8. Voice and copy

- **Plain and specific.** "Gradient Descent is dim. One Encounter will help." not "Let's level up your knowledge!"
- **Controls name their action.** "Start Daily Quest", "Find my party", "Send to class", "Push an Encounter".
- **Errors name the problem and the recovery.**
- **No exclamation spam, no emoji, no baby talk, no streak shaming.**
- **Honest labels.** Sample data is called sample data. XP is called XP. Mastery is called mastery.
- **Professor copy is neutral and operational** ("Needs a reteach", "High effort, low mastery", "Check in"). Never judgmental about students.

Words to use: star, light, dim, lit, shining, Encounter, Daily Quest, Eclipse, party, Class Sky, mastery, XP, streak, form.
Words to avoid: level up, grind, smash, crush, epic, hero, loot, "oops" in body copy, "you failed".

---

## 9. Anti-slop rules and review checklist

Spark has been rejected twice for feeling generic ("something feels off", then "feels like AI slop, not unique"). This section records what was wrong and what to check before shipping any screen.

### 9.1 What went wrong in v1 and v1.5

| Issue | Cause |
| --- | --- |
| Felt off | Dark navy night-sky skin did not match the user's warm light palette or Preree's light layout |
| Felt generic | Equal cards, eyebrow labels, glow filters on stars, modal encounters, a default Fredoka plus Nunito pairing, a template-like dashboard rhythm |
| Mascot felt static | Idle bobbing only. It did not behave like Duolingo's mascot (reactive, expressive, always responding) |

### 9.2 Review checklist (run before calling a screen done)

Direction and honesty
- [ ] Does the screen say something only Spark could say (fill-level stars, Spark on the map, effort versus mastery)?
- [ ] Is every number real or labeled sample?
- [ ] Does light still come only from mastery?

Slop tells to delete on sight
- [ ] Eyebrow or kicker labels above headings
- [ ] Grids of identical icon plus heading plus text cards
- [ ] A hero metric (big number, small label, accent)
- [ ] Glow halos, glass, gradient text, hard offset shadows
- [ ] Emoji or unicode glyphs used as icons
- [ ] A modal for anything that does not need protected focus
- [ ] Colored left borders on cards or callouts
- [ ] Display type in buttons, labels and data

Craft floor
- [ ] Contrast: body 4.5:1 or better, large text 3:1, check text on yellow and orange
- [ ] Every control has default, hover, focus, active and disabled states
- [ ] Keyboard path works end to end (stars are focusable, Enter or Space selects, 1 to 3 answer, Enter continues)
- [ ] Text selection, scrollbars and focus rings use the palette
- [ ] Loading uses skeletons, empty states teach, errors recover
- [ ] Tested at about 400 px and at 1360 px with real copy and no horizontal page scroll

Mascot
- [ ] Spark reacts to the last action within 150 ms
- [ ] Wrong answers never scold
- [ ] The mascot never covers content or blocks input
- [ ] Reduced motion fully respected

### 9.3 Where the prototype still reads a bit AI-ish (known, open)

- Rounded display plus rounded sans can feel stock. Try a more distinctive wordmark and keep body copy in a sturdier sans.
- The Spark tab is a stack of three similar sections (form, quest, Eclipse). Consider giving the Eclipse a real illustration or a shape of its own rather than another bar.
- The map is clear but lane bands are plain rectangles. Lane bands could carry a quiet course-specific texture or a progress path that follows each track.
- The side panel has no memorable "home" moment yet. A short daily greeting that references yesterday's actual work would help.

---

## 10. Accessibility and responsive behavior

- **Contrast:** hold WCAG AA. Muted text uses `#5f5b54` on `#fffdf8`. Orange used as text uses `#a9481a`. Never put white text on yellow.
- **Not color alone:** star state is carried by fill level, outline style (dashed for locked), ray ticks (shining), lock icon and the text label under each star. Tags always include words.
- **Keyboard:** every star is a focusable button with a visible dashed focus ring. Enter or Space selects. In an Encounter, keys 1 to 3 choose an answer and Enter continues. Tabs and buttons are native buttons.
- **Screen readers:** each star has an aria label with name, state, percent. The Spark speech bubble is `role="status"` with `aria-live="polite"`. The mascot SVG has a short label ("Spark the mascot, Glow form"). The summary pill has a full text label for its counts.
- **Reduced motion:** see 7.4.
- **Touch:** controls are at least 34 px tall (primary buttons 40 px); stars have a 46 px hit radius.
- **Responsive:** under 980 px the two columns stack; the map has a 780 px minimum width inside its own horizontal scroller; header wraps; no horizontal scroll on the page body at 400 px. Respect safe-area insets on phones.
- **Language:** English only for now. Strings should live in one dictionary so translation is possible later.

---

## 11. Open questions and next design steps

Product decisions
1. **XP economy.** Is bonus XP for party quests worth the complexity? Should XP feed anything beyond the professor view (cosmetic Spark accessories, for example) or stay purely informational?
2. **Mastery scale versus Preree thresholds.** Preree treats 0.70 and above as green. Spark uses 60 for Lit and 85 for Shining. Pick one set before building the engine (the technical doc recommends Spark's, with a migration note).
3. **Decay.** Does mastery decay on a schedule (spaced-repetition style) or only mark stars as Fading while keeping the number? Decaying mastery is more honest but can feel punishing.
4. **Passive attendance.** Preree gives a small passive boost (+0.05, capped at 0.30) for attending when a concept is mentioned. Does Spark keep it? It conflicts with "light only comes from demonstrated mastery" unless it is capped below the first lit threshold, which it is.
5. **Grades.** Should professors be able to export mastery to a gradebook? Out of scope for now. Spark is formative only.
6. **Cohort comparison.** Do students ever see how they compare to the class? Default no. The map is personal. Parties are the social surface.

Design next steps
- Replace stock rounded type with a more distinctive wordmark and test a sturdier UI sans.
- Give the Eclipse its own visual (not a bar).
- Mock the post-lecture recap (what today dimmed) as the daily home moment.
- Design the professor course-setup flow (PDF upload to starter map, drag to reposition stars).
- Design the Zoom lecture entry point (how a student joins a live session and how Spark appears in a Zoom side panel or companion window).
- Run a usability test with five students on the question "do you believe the star is as lit as you are?"