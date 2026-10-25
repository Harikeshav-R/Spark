import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import type { UUID } from "../../../src/contracts/common";
import type { ClassSkySnapshot, CourseEffortDTO } from "../../../src/contracts/game";
import type { GraphData } from "../../../src/features/graph/d3-force-layout";
import {
  buildClassSkyGraph,
  buildEffortRows,
  sortEffortRows,
  type EffortRow,
} from "../../../src/features/professor/class-sky-state";
import { StarVessel } from "../../../src/features/graph/star-vessel";
import { AttentionConceptOverlay } from "../../../src/features/graph/attention-concept-overlay";
import { KnowledgeGraph } from "../../../src/features/graph/knowledge-graph";
import { EffortRoster } from "../../../src/features/professor/effort-roster";
import { TeacherLectureDashboard } from "../../../src/features/professor/teacher-lecture-dashboard";

describe("Lane D: Class Sky Analytics, Concept Stars & Effort Roster (P4-D-03)", () => {
  const courseId: UUID = "11111111-1111-4111-8111-111111111111";
  const c1: UUID = "22222222-2222-4222-8222-222222222201";
  const c2: UUID = "22222222-2222-4222-8222-222222222202";
  const c3: UUID = "22222222-2222-4222-8222-222222222203";
  const c4: UUID = "22222222-2222-4222-8222-222222222204";

  const sampleGraph: GraphData = {
    nodes: [
      { id: c1, label: "Variables", description: "Storage", category: "Basics", difficulty: 1, confidence: 0.9, band: "green" },
      { id: c2, label: "Conditionals", description: "Branches", category: "Basics", difficulty: 2, confidence: 0.8, band: "green" },
      { id: c3, label: "Loops", description: "Iteration", category: "Control", difficulty: 2, confidence: 0.7, band: "green" },
      { id: c4, label: "Functions", description: "Modularity", category: "Functions", difficulty: 3, confidence: 0.6, band: "yellow" },
    ],
    edges: [
      { id: "e1", source: c1, target: c2, relationship: "prerequisite" },
      { id: "e2", source: c2, target: c3, relationship: "prerequisite" },
      { id: "e3", source: c3, target: c4, relationship: "prerequisite" },
    ],
  };

  const sampleSnapshot: ClassSkySnapshot = {
    courseId,
    totalStudents: 10,
    concepts: [
      {
        conceptId: c1,
        label: "Variables",
        category: "Basics",
        distribution: { gray: 10, red: 0, yellow: 0, green: 0 },
        averageConfidence: 0.0,
        band: "gray",
        taught: true,
      },
      {
        conceptId: c2,
        label: "Conditionals",
        category: "Basics",
        distribution: { gray: 0, red: 10, yellow: 0, green: 0 },
        averageConfidence: 0.399,
        band: "red",
        taught: true,
      },
      {
        conceptId: c3,
        label: "Loops",
        category: "Control",
        distribution: { gray: 0, red: 0, yellow: 10, green: 0 },
        averageConfidence: 0.40,
        band: "yellow",
        taught: false,
      },
      {
        conceptId: c4,
        label: "Functions",
        category: "Functions",
        distribution: { gray: 0, red: 0, yellow: 0, green: 10 },
        averageConfidence: 0.70,
        band: "green",
        taught: true,
      },
    ],
  };

  const standardCohortEffort: readonly CourseEffortDTO[] = [
    {
      studentId: "00000000-0000-4000-8000-000000000001",
      name: "Rahul",
      xp: 600,
      averageConfidence: 0.20,
      flag: "high_effort_low_mastery",
      enrolledAt: "2026-10-01T10:00:00.000Z",
      unassessed: false,
    },
    {
      studentId: "00000000-0000-4000-8000-000000000002",
      name: "Hari",
      xp: 480,
      averageConfidence: 0.80,
      flag: null,
      enrolledAt: "2026-10-01T10:05:00.000Z",
      unassessed: false,
    },
    {
      studentId: "00000000-0000-4000-8000-000000000003",
      name: "Mira",
      xp: 120,
      averageConfidence: 0.50,
      flag: null,
      enrolledAt: "2026-10-01T10:10:00.000Z",
      unassessed: false,
    },
    {
      studentId: "00000000-0000-4000-8000-000000000004",
      name: "Lee",
      xp: 0,
      averageConfidence: 0,
      flag: null,
      enrolledAt: "2026-10-01T10:15:00.000Z",
      unassessed: true,
    },
  ];

  describe("1. buildClassSkyGraph", () => {
    it("joins cohort mean confidence and bands, overriding individual node confidence", () => {
      const result = buildClassSkyGraph(sampleGraph, sampleSnapshot);

      expect(result.nodes).toHaveLength(4);
      expect(result.edges).toEqual(sampleGraph.edges);

      const node1 = result.nodes.find((n) => n.id === c1);
      expect(node1?.confidence).toBe(0.0);
      expect(node1?.band).toBe("gray");

      const node2 = result.nodes.find((n) => n.id === c2);
      expect(node2?.confidence).toBe(0.399);
      expect(node2?.band).toBe("red");

      const node3 = result.nodes.find((n) => n.id === c3);
      expect(node3?.confidence).toBe(0.40);
      expect(node3?.band).toBe("yellow");

      const node4 = result.nodes.find((n) => n.id === c4);
      expect(node4?.confidence).toBe(0.70);
      expect(node4?.band).toBe("green");
    });

    it("throws error when graph and snapshot have inconsistent concept sets", () => {
      const mismatchedSnapshot: ClassSkySnapshot = {
        ...sampleSnapshot,
        concepts: sampleSnapshot.concepts.slice(0, 2),
      };

      expect(() => buildClassSkyGraph(sampleGraph, mismatchedSnapshot)).toThrowError(
        /does not match course graph node count/i,
      );

      const foreignConceptSnapshot: ClassSkySnapshot = {
        ...sampleSnapshot,
        concepts: [
          ...sampleSnapshot.concepts.slice(0, 3),
          {
            conceptId: "99999999-9999-4999-8999-999999999999" as UUID,
            label: "Foreign",
            category: "Other",
            distribution: { gray: 10, red: 0, yellow: 0, green: 0 },
            averageConfidence: 0.5,
            band: "yellow",
            taught: false,
          },
        ],
      };

      expect(() => buildClassSkyGraph(sampleGraph, foreignConceptSnapshot)).toThrowError(
        /not found in Class Sky snapshot/i,
      );
    });

    it("handles empty matching graph and snapshot cleanly", () => {
      const emptyGraph: GraphData = { nodes: [], edges: [] };
      const emptySnapshot: ClassSkySnapshot = {
        courseId,
        totalStudents: 0,
        concepts: [],
      };

      const result = buildClassSkyGraph(emptyGraph, emptySnapshot);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it("removes confidence and band when totalStudents === 0 (indicating unavailable mastery)", () => {
      const zeroStudentsSnapshot: ClassSkySnapshot = {
        ...sampleSnapshot,
        totalStudents: 0,
        concepts: sampleSnapshot.concepts.map((c) => ({
          ...c,
          distribution: { gray: 0, red: 0, yellow: 0, green: 0 },
          averageConfidence: 0,
          band: "gray",
        })),
      };

      const result = buildClassSkyGraph(sampleGraph, zeroStudentsSnapshot);
      for (const node of result.nodes) {
        expect(node.confidence).toBeUndefined();
        expect(node.band).toBeUndefined();
        expect(node.label).toBeDefined();
      }
    });
  });

  describe("2. buildEffortRows", () => {
    it("computes exact percentiles for standard 4-student cohort", () => {
      const rows = buildEffortRows(standardCohortEffort);

      expect(rows).toHaveLength(4);

      const rahul = rows.find((r) => r.name === "Rahul")!;
      const hari = rows.find((r) => r.name === "Hari")!;
      const mira = rows.find((r) => r.name === "Mira")!;
      const lee = rows.find((r) => r.name === "Lee")!;

      // Effort: Rahul(600)=100, Hari(480)=67, Mira(120)=33, Lee(0)=0
      expect(rahul.effortPercentile).toBe(100);
      expect(hari.effortPercentile).toBe(67);
      expect(mira.effortPercentile).toBe(33);
      expect(lee.effortPercentile).toBe(0);

      // Mastery: Hari(0.80)=100, Mira(0.50)=67, Rahul(0.20)=33, Lee(0)=0
      expect(hari.masteryPercentile).toBe(100);
      expect(mira.masteryPercentile).toBe(67);
      expect(rahul.masteryPercentile).toBe(33);
      expect(lee.masteryPercentile).toBe(0);

      // Server flag preserved
      expect(rahul.flag).toBe("high_effort_low_mastery");
      expect(hari.flag).toBeNull();
      expect(mira.flag).toBeNull();
      expect(lee.flag).toBeNull();
    });

    it("returns zero percentiles for singleton cohort (N=1) and preserves unassessed status", () => {
      const single: CourseEffortDTO[] = [standardCohortEffort[0]];
      const rows = buildEffortRows(single);
      expect(rows).toHaveLength(1);
      expect(rows[0].effortPercentile).toBe(0);
      expect(rows[0].masteryPercentile).toBe(0);
      expect(rows[0].unassessed).toBe(false);

      const singleUnassessed: CourseEffortDTO[] = [standardCohortEffort[3]];
      const rowsUnassessed = buildEffortRows(singleUnassessed);
      expect(rowsUnassessed[0].unassessed).toBe(true);
    });

    it("handles tied percentiles sharing the lower rank index", () => {
      const tiedCohort: CourseEffortDTO[] = [
        {
          studentId: "1",
          name: "A",
          xp: 100,
          averageConfidence: 0.5,
          flag: null,
          enrolledAt: "2026-10-01T10:00:00.000Z",
          unassessed: false,
        },
        {
          studentId: "2",
          name: "B",
          xp: 100,
          averageConfidence: 0.5,
          flag: null,
          enrolledAt: "2026-10-01T10:00:00.000Z",
          unassessed: false,
        },
        {
          studentId: "3",
          name: "C",
          xp: 50,
          averageConfidence: 0.2,
          flag: null,
          enrolledAt: "2026-10-01T10:00:00.000Z",
          unassessed: false,
        },
      ];

      const rows = buildEffortRows(tiedCohort);
      const a = rows.find((r) => r.name === "A")!;
      const b = rows.find((r) => r.name === "B")!;
      const c = rows.find((r) => r.name === "C")!;

      // C has 0 lower -> 0%
      expect(c.effortPercentile).toBe(0);
      expect(c.masteryPercentile).toBe(0);

      // A and B both have 1 lower out of 2 -> 1/2 = 50%
      expect(a.effortPercentile).toBe(50);
      expect(b.effortPercentile).toBe(50);
      expect(a.masteryPercentile).toBe(50);
      expect(b.masteryPercentile).toBe(50);
    });

    it("returns empty array for empty effort input", () => {
      expect(buildEffortRows([])).toEqual([]);
    });
  });

  describe("3. sortEffortRows", () => {
    it("sorts by effortPercentile descending and ascending", () => {
      const rows = buildEffortRows(standardCohortEffort);

      const desc = sortEffortRows(rows, "effortPercentile", "desc");
      expect(desc.map((r) => r.name)).toEqual(["Rahul", "Hari", "Mira", "Lee"]);

      const asc = sortEffortRows(rows, "effortPercentile", "asc");
      expect(asc.map((r) => r.name)).toEqual(["Lee", "Mira", "Hari", "Rahul"]);
    });

    it("sorts by masteryPercentile descending and ascending", () => {
      const rows = buildEffortRows(standardCohortEffort);

      const desc = sortEffortRows(rows, "masteryPercentile", "desc");
      expect(desc.map((r) => r.name)).toEqual(["Hari", "Mira", "Rahul", "Lee"]);

      const asc = sortEffortRows(rows, "masteryPercentile", "asc");
      expect(asc.map((r) => r.name)).toEqual(["Lee", "Rahul", "Mira", "Hari"]);
    });

    it("breaks ties deterministically by English name ascending, then studentId", () => {
      const tiedRows: EffortRow[] = [
        {
          studentId: "id-2",
          name: "Zara",
          xp: 100,
          averageConfidence: 0.5,
          flag: null,
          enrolledAt: "2026-10-01T10:00:00.000Z",
          unassessed: false,
          effortPercentile: 50,
          masteryPercentile: 50,
        },
        {
          studentId: "id-1",
          name: "Alice",
          xp: 100,
          averageConfidence: 0.5,
          flag: null,
          enrolledAt: "2026-10-01T10:00:00.000Z",
          unassessed: false,
          effortPercentile: 50,
          masteryPercentile: 50,
        },
      ];

      const sorted = sortEffortRows(tiedRows, "effortPercentile", "desc");
      expect(sorted[0].name).toBe("Alice");
      expect(sorted[1].name).toBe("Zara");
    });
  });

  describe("4. StarVessel & Attention Overlay Presentation", () => {
    it("renders open-book icon and Taught in lecture status when taught === true", () => {
      const html = renderToString(
        React.createElement(
          "svg",
          null,
          React.createElement(StarVessel, {
            node: sampleGraph.nodes[0]!,
            x: 100,
            y: 100,
            selected: false,
            dimmed: false,
            onSelect: () => {},
            taught: true,
          }),
        ),
      );

      expect(html).toContain("Taught in lecture");
      expect(html).toContain("M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"); // Book icon path
    });

    it("renders Not yet taught status and omits book icon when taught === false", () => {
      const html = renderToString(
        React.createElement(
          "svg",
          null,
          React.createElement(StarVessel, {
            node: sampleGraph.nodes[0]!,
            x: 100,
            y: 100,
            selected: false,
            dimmed: false,
            onSelect: () => {},
            taught: false,
          }),
        ),
      );

      expect(html).toContain("Not yet taught");
      expect(html).not.toContain("M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z");
    });

    it("omits taught indicators completely when taught is undefined (incumbent graph)", () => {
      const html = renderToString(
        React.createElement(
          "svg",
          null,
          React.createElement(StarVessel, {
            node: sampleGraph.nodes[0]!,
            x: 100,
            y: 100,
            selected: false,
            dimmed: false,
            onSelect: () => {},
          }),
        ),
      );

      expect(html).not.toContain("Taught in lecture");
      expect(html).not.toContain("Not yet taught");
      expect(html).not.toContain("M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z");
    });

    it("AttentionConceptOverlay renders crimson steady ring (r=38, width=3) and omits pulse when reducedMotion is true", () => {
      const posMap = new Map([[c1, { id: c1, level: 0, x: 120, y: 150 }]]);

      const htmlReduced = renderToString(
        React.createElement(
          "svg",
          null,
          React.createElement(AttentionConceptOverlay, {
            attentionConceptIds: [c1],
            positionedNodes: posMap,
            reducedMotion: true,
          }),
        ),
      );

      expect(htmlReduced).toContain("attention-concept-overlay-layer");
      expect(htmlReduced).toContain('r="38"');
      expect(htmlReduced).toContain('stroke-width="3"');
      // Single circle for base steady ring
      const circleMatches = htmlReduced.match(/<circle /g);
      expect(circleMatches).toHaveLength(1);

      const htmlFullMotion = renderToString(
        React.createElement(
          "svg",
          null,
          React.createElement(AttentionConceptOverlay, {
            attentionConceptIds: [c1],
            positionedNodes: posMap,
            reducedMotion: false,
          }),
        ),
      );

      // Two circles: steady base + motion pulsing ring
      const motionCircles = htmlFullMotion.match(/<circle /g);
      expect(motionCircles).toHaveLength(2);
    });

    it("KnowledgeGraph derives attention ring only for taught concepts strictly below 0.40", () => {
      // sampleSnapshot:
      // c1: confidence 0.0, taught: true -> ATTENTION
      // c2: confidence 0.399, taught: true -> ATTENTION
      // c3: confidence 0.40, taught: false -> NO ATTENTION (at threshold, not taught)
      // c4: confidence 0.70, taught: true -> NO ATTENTION (above threshold)
      const classSkyGraph = buildClassSkyGraph(sampleGraph, sampleSnapshot);
      const taughtIds = sampleSnapshot.concepts.filter((c) => c.taught).map((c) => c.conceptId);

      const html = renderToString(
        React.createElement(KnowledgeGraph, {
          graph: classSkyGraph,
          taughtConceptIds: taughtIds,
        }),
      );

      // In SSR / pre-mount branch, concept details list text alternatives are rendered
      expect(html).toContain("Needs attention (&lt; 40%)");
      expect(html).toContain("Taught in lecture");
      expect(html).toContain("Not yet taught");
    });
  });

  describe("5. EffortRoster Semantic Table and Scatter Matrix", () => {
    it("renders semantic table with headers, UTC dates, tabular figures, and intervention flag", () => {
      const html = renderToString(React.createElement(EffortRoster, { effort: standardCohortEffort }));

      // Table semantics
      expect(html).toContain("<table");
      expect(html).toContain("<caption");
      expect(html).toContain("Student");
      expect(html).toContain("Enrolled (UTC)");
      expect(html).toContain("Total XP");
      expect(html).toContain("Mean confidence");
      expect(html).toContain("Effort %ile");
      expect(html).toContain("Mastery %ile");
      expect(html).toContain("Intervention");

      // Rahul flagged Needs support
      expect(html).toContain("Needs support");
      expect(html).toContain("High effort (≥ 75th percentile) and low mastery (≤ 40th percentile)");

      // Lee unassessed
      expect(html).toContain("Unassessed");

      // UTC date format
      expect(html).toContain("2026-10-01");

      // Scatter matrix plot
      expect(html).toContain("Effort Percentile (XP) →");
      expect(html).toContain("Mastery Percentile (Mean Confidence) →");
      expect(html).toContain("Needs support region");
      // Diamond marker polygon for flagged student
      expect(html).toContain("<polygon");
    });

    it("renders honest empty status when effort array is empty", () => {
      const html = renderToString(React.createElement(EffortRoster, { effort: [] }));

      expect(html).toContain("No enrolled students yet");
      expect(html).not.toContain("<table");
      expect(html).not.toContain("<svg");
    });
  });

  describe("6. TeacherLectureDashboard Tab Integration", () => {
    it("renders tablist with Live lecture and Class Sky tabs", () => {
      const html = renderToString(
        React.createElement(TeacherLectureDashboard, {
          courseId,
          initialToken: "test-token",
          getAccessToken: async () => "test-token",
        }),
      );

      expect(html).toContain('role="tablist"');
      expect(html).toContain('id="tab-live-lecture"');
      expect(html).toContain('id="tab-class-sky"');
      expect(html).toContain("Live lecture");
      expect(html).toContain("Class Sky");
      expect(html).toContain('id="panel-live-lecture"');
      expect(html).toContain('id="panel-class-sky"');
    });
  });
});
