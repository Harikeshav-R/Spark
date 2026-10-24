import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { AppError } from "../../../src/contracts/errors";
import {
  CourseRepository,
  EnrollmentRepository,
  EnrollmentService,
  GraphRepository,
  GraphService,
  MasteryRepository,
} from "../../../src/server/core/index";
import {
  FIXTURE_33_CONCEPTS,
  FIXTURE_34_EDGES,
} from "../../fixtures/ai.fixture";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

function getDatabaseContainerName(): string {
  const output = execFileSync(
    "docker",
    ["ps", "--filter", "publish=54322", "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const names = output.split("\n").map((s) => s.trim()).filter(Boolean);
  if (names.length !== 1) {
    throw new Error(
      `Expected exactly 1 local database container on port 54322, found: ${names.join(", ")}`,
    );
  }
  return names[0];
}

function getCanonicalNodes() {
  return FIXTURE_33_CONCEPTS.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ id, courseId, createdAt, ...node }) => ({ ...node }),
  );
}

describe.skipIf(isFixtureMode)(
  "P2-A-02: Graph Persistence & Atomic Commit (live local Supabase)",
  () => {
    let harness: SupabaseTestHarness;
    let currentContext: TestContext;
    let courseRepo: CourseRepository;
    let graphRepo: GraphRepository;
    let masteryRepo: MasteryRepository;
    let enrollmentService: EnrollmentService;
    let containerName: string;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      courseRepo = new CourseRepository(harness.serviceClient);
      graphRepo = new GraphRepository(harness.serviceClient, courseRepo);
      masteryRepo = new MasteryRepository(harness.serviceClient);
      enrollmentService = new EnrollmentService(
        new EnrollmentRepository(harness.serviceClient),
      );
      containerName = getDatabaseContainerName();
    });

    afterEach(async () => {
      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("1. commits 33/34 graph with 4 enrolled students, initializing 132 mastery rows and preserving coordinates", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, {
        conceptCount: 0,
      });
      const teacher = currentContext.users.find(
        (u) => u.authId === course.teacherAuthId,
      )!;
      const teacherActor = harness.buildTeacherActor(teacher, course.teacherId);
      const graphService = new GraphService(
        teacherActor,
        graphRepo,
        masteryRepo,
      );

      // Enroll 4 students prior to graph commit
      const studentIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        const studentUser = await harness.createTestUser(
          currentContext,
          "student",
        );
        const enrolled = await enrollmentService.enrollStudent(
          harness.buildStudentActor(studentUser),
          course.joinCode,
        );
        studentIds.push(enrolled.id);
      }

      // Add coordinates to first node to verify coordinate round-trip
      const nodes = getCanonicalNodes();
      nodes[0] = { ...nodes[0], x: 120.5, y: 340.25 };

      const result = await graphService.commitKnowledgeGraph(
        teacherActor,
        course.courseId,
        nodes,
        FIXTURE_34_EDGES,
      );

      expect(result).toEqual({ nodeCount: 33, edgeCount: 34 });

      // Verify concept_nodes
      const { data: dbNodes, error: nodeErr } = await harness.serviceClient
        .from("concept_nodes")
        .select("id,label,x,y")
        .eq("course_id", course.courseId);
      expect(nodeErr).toBeNull();
      expect(dbNodes).toHaveLength(33);

      const nodeMap = new Map(dbNodes!.map((n) => [n.label, n.id]));
      const nodeWithCoord = dbNodes!.find((n) => n.label === nodes[0].label);
      expect(nodeWithCoord?.x).toBe(120.5);
      expect(nodeWithCoord?.y).toBe(340.25);

      // Verify concept_edges
      const { data: dbEdges, error: edgeErr } = await harness.serviceClient
        .from("concept_edges")
        .select("source_id,target_id,relationship")
        .eq("course_id", course.courseId);
      expect(edgeErr).toBeNull();
      expect(dbEdges).toHaveLength(34);
      expect(dbEdges!.every((e) => e.relationship === "prerequisite")).toBe(
        true,
      );

      const edgePairs = new Set(
        dbEdges!.map((e) => `${e.source_id}:${e.target_id}`),
      );
      for (const [source, target] of FIXTURE_34_EDGES) {
        const expectedPair = `${nodeMap.get(source)}:${nodeMap.get(target)}`;
        expect(edgePairs.has(expectedPair)).toBe(true);
      }

      // Verify 132 mastery rows (4 students * 33 concepts)
      const { data: masteryRows, error: masteryErr } =
        await harness.serviceClient
          .from("student_mastery")
          .select("student_id,concept_id,confidence,attempts,version")
          .in("student_id", studentIds);

      expect(masteryErr).toBeNull();
      expect(masteryRows).toHaveLength(132);
      expect(
        masteryRows!.every(
          (m) => m.confidence === 0.0 && m.attempts === 0 && m.version === 1,
        ),
      ).toBe(true);
    });

    it("2. rejects second commit attempt with 409 GRAPH_ALREADY_EXISTS and leaves original state intact", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, {
        conceptCount: 0,
      });
      const teacher = currentContext.users.find(
        (u) => u.authId === course.teacherAuthId,
      )!;
      const teacherActor = harness.buildTeacherActor(teacher, course.teacherId);
      const graphService = new GraphService(
        teacherActor,
        graphRepo,
        masteryRepo,
      );

      const nodes = getCanonicalNodes();
      await graphService.commitKnowledgeGraph(
        teacherActor,
        course.courseId,
        nodes,
        FIXTURE_34_EDGES,
      );

      const { data: originalNodes } = await harness.serviceClient
        .from("concept_nodes")
        .select("id")
        .eq("course_id", course.courseId);

      // Repeat commit
      await expect(
        graphService.commitKnowledgeGraph(
          teacherActor,
          course.courseId,
          nodes,
          FIXTURE_34_EDGES,
        ),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(409);
        expect(appErr.code).toBe("GRAPH_ALREADY_EXISTS");
        return true;
      });

      const { data: postNodes } = await harness.serviceClient
        .from("concept_nodes")
        .select("id")
        .eq("course_id", course.courseId);

      expect(postNodes).toHaveLength(originalNodes!.length);
    });

    it("3. handles concurrent graph commits safely with exactly one winning and one 409", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, {
        conceptCount: 0,
      });
      const teacher = currentContext.users.find(
        (u) => u.authId === course.teacherAuthId,
      )!;
      const teacherActor = harness.buildTeacherActor(teacher, course.teacherId);
      const graphService = new GraphService(
        teacherActor,
        graphRepo,
        masteryRepo,
      );

      const nodes = getCanonicalNodes();
      const results = await Promise.allSettled([
        graphService.commitKnowledgeGraph(
          teacherActor,
          course.courseId,
          nodes,
          FIXTURE_34_EDGES,
        ),
        graphService.commitKnowledgeGraph(
          teacherActor,
          course.courseId,
          nodes,
          FIXTURE_34_EDGES,
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const reason = (rejected[0] as PromiseRejectedResult).reason as AppError;
      expect(reason.statusCode).toBe(409);
      expect(reason.code).toBe("GRAPH_ALREADY_EXISTS");
    });

    it("4. enforces strict role, course ownership, and actor isolation on commit and read", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, {
        conceptCount: 0,
      });
      const teacher = currentContext.users.find(
        (u) => u.authId === course.teacherAuthId,
      )!;
      const teacherActor = harness.buildTeacherActor(teacher, course.teacherId);

      const otherTeacherUser = await harness.createTestUser(
        currentContext,
        "teacher",
      );
      const otherTeacherActor = harness.buildTeacherActor(
        otherTeacherUser,
        "99999999-9999-4999-8999-999999999999",
      );

      const studentUser = await harness.createTestUser(
        currentContext,
        "student",
      );
      const studentActor = harness.buildStudentActor(studentUser);

      const nodes = getCanonicalNodes();

      // Student commit rejected
      const studentGraph = new GraphService(
        studentActor,
        graphRepo,
        masteryRepo,
      );
      await expect(
        studentGraph.commitKnowledgeGraph(
          studentActor,
          course.courseId,
          nodes,
          FIXTURE_34_EDGES,
        ),
      ).rejects.toSatisfy((err: unknown) => {
        expect((err as AppError).statusCode).toBe(403);
        return true;
      });

      // Other teacher commit rejected (not owner of course)
      const otherTeacherGraph = new GraphService(
        otherTeacherActor,
        graphRepo,
        masteryRepo,
      );
      await expect(
        otherTeacherGraph.commitKnowledgeGraph(
          otherTeacherActor,
          course.courseId,
          nodes,
          FIXTURE_34_EDGES,
        ),
      ).rejects.toSatisfy((err: unknown) => {
        expect((err as AppError).statusCode).toBe(403);
        return true;
      });

      // Direct RPC with wrong authId rejected with 42501
      const rpcDirect = await harness.serviceClient.rpc(
        "commit_knowledge_graph",
        {
          p_actor_auth_id: otherTeacherUser.authId,
          p_course_id: course.courseId,
          p_nodes: nodes,
          p_edges: FIXTURE_34_EDGES,
        },
      );
      expect(rpcDirect.error?.code).toBe("42501");

      // Mismatched actor on bound GraphService fails 403
      const boundGraph = new GraphService(
        teacherActor,
        graphRepo,
        masteryRepo,
      );
      await expect(
        boundGraph.commitKnowledgeGraph(
          otherTeacherActor,
          course.courseId,
          nodes,
          FIXTURE_34_EDGES,
        ),
      ).rejects.toSatisfy((err: unknown) => {
        expect((err as AppError).statusCode).toBe(403);
        return true;
      });
    });

    it("5. handles authorized empty course and accurate teacher/student graph projections", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, {
        conceptCount: 0,
      });
      const teacher = currentContext.users.find(
        (u) => u.authId === course.teacherAuthId,
      )!;
      const teacherActor = harness.buildTeacherActor(teacher, course.teacherId);
      const graphService = new GraphService(
        teacherActor,
        graphRepo,
        masteryRepo,
      );

      // Empty topology
      const emptyGraph = await graphService.getCourseGraph(
        teacherActor,
        course.courseId,
      );
      expect(emptyGraph.nodes).toHaveLength(0);
      expect(emptyGraph.edges).toHaveLength(0);

      const emptyImportance = await graphService.calculateImportance(
        course.courseId,
      );
      expect(emptyImportance.size).toBe(0);

      // Now enroll student and commit graph
      const studentUser = await harness.createTestUser(
        currentContext,
        "student",
      );
      const enrolled = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );

      const nodes = getCanonicalNodes();
      await graphService.commitKnowledgeGraph(
        teacherActor,
        course.courseId,
        nodes,
        FIXTURE_34_EDGES,
      );

      // Teacher view
      const teacherView = await graphService.getCourseGraph(
        teacherActor,
        course.courseId,
      );
      expect(teacherView.nodes).toHaveLength(33);
      expect(
        teacherView.nodes.every(
          (n) => n.confidence === undefined && n.band === undefined,
        ),
      ).toBe(true);

      // Student view
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: enrolled.id, courseId: course.courseId },
      ]);
      const studentGraph = new GraphService(
        studentActor,
        graphRepo,
        masteryRepo,
      );
      const studentView = await studentGraph.getCourseGraph(
        studentActor,
        course.courseId,
      );
      expect(studentView.nodes).toHaveLength(33);
      expect(
        studentView.nodes.every(
          (n) => n.confidence === 0.0 && n.band === "gray",
        ),
      ).toBe(true);
    });

    it("6. rejects invalid topology in service and direct RPC without persisting partial data", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, {
        conceptCount: 0,
      });
      const teacher = currentContext.users.find(
        (u) => u.authId === course.teacherAuthId,
      )!;
      const teacherActor = harness.buildTeacherActor(teacher, course.teacherId);
      const graphService = new GraphService(
        teacherActor,
        graphRepo,
        masteryRepo,
      );

      const nodes = getCanonicalNodes();
      const cyclicEdges: [string, string][] = [
        ...FIXTURE_34_EDGES,
        ["Matrices", "Vectors"],
      ];

      // Service call with cycle rejected
      await expect(
        graphService.commitKnowledgeGraph(
          teacherActor,
          course.courseId,
          nodes,
          cyclicEdges,
        ),
      ).rejects.toSatisfy((err: unknown) => {
        expect((err as AppError).statusCode).toBe(422);
        return true;
      });

      // Direct RPC with missing endpoint
      const rpcMissingEndpoint = await harness.serviceClient.rpc(
        "commit_knowledge_graph",
        {
          p_actor_auth_id: teacher.authId,
          p_course_id: course.courseId,
          p_nodes: nodes,
          p_edges: [["Nonexistent", "Vectors"]],
        },
      );
      expect(rpcMissingEndpoint.error?.code).toBe("P0001");
      expect(rpcMissingEndpoint.error?.message).toContain("INVALID_GRAPH");

      // Verify nothing was persisted
      const { data: dbNodes } = await harness.serviceClient
        .from("concept_nodes")
        .select("id")
        .eq("course_id", course.courseId);
      expect(dbNodes).toHaveLength(0);
    });

    it("7. atomically rolls back entire transaction if edge or mastery insert fails", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, {
        conceptCount: 0,
      });
      const teacher = currentContext.users.find(
        (u) => u.authId === course.teacherAuthId,
      )!;
      const teacherActor = harness.buildTeacherActor(teacher, course.teacherId);
      const graphService = new GraphService(
        teacherActor,
        graphRepo,
        masteryRepo,
      );

      const triggerName = `trg_fail_edges_${course.courseId.replace(/-/g, "")}`;
      const fnName = `fn_fail_edges_${course.courseId.replace(/-/g, "")}`;

      const installSql = `
        CREATE OR REPLACE FUNCTION ${fnName}()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.course_id = '${course.courseId}'::uuid THEN
            RAISE EXCEPTION 'Simulated edge insert failure' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON public.concept_edges
        FOR EACH ROW
        EXECUTE FUNCTION ${fnName}();
      `;

      try {
        execFileSync(
          "docker",
          ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
          { input: installSql },
        );

        const nodes = getCanonicalNodes();
        await expect(
          graphService.commitKnowledgeGraph(
            teacherActor,
            course.courseId,
            nodes,
            FIXTURE_34_EDGES,
          ),
        ).rejects.toThrow();

        // Verify concepts rolled back too
        const { data: dbNodes } = await harness.serviceClient
          .from("concept_nodes")
          .select("id")
          .eq("course_id", course.courseId);
        expect(dbNodes).toHaveLength(0);
      } finally {
        const cleanupSql = `
          DROP TRIGGER IF EXISTS ${triggerName} ON public.concept_edges;
          DROP FUNCTION IF EXISTS ${fnName}();
        `;
        execFileSync(
          "docker",
          ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
          { input: cleanupSql },
        );
      }
    });

    it("8. serializes concurrent enrollment and graph commit without deadlocks", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, {
        conceptCount: 0,
      });
      const teacher = currentContext.users.find(
        (u) => u.authId === course.teacherAuthId,
      )!;
      const teacherActor = harness.buildTeacherActor(teacher, course.teacherId);
      const graphService = new GraphService(
        teacherActor,
        graphRepo,
        masteryRepo,
      );

      // Student holds transaction with enroll_student in child psql process
      const studentUser = await harness.createTestUser(
        currentContext,
        "student",
      );

      const psqlChild = spawn("docker", [
        "exec",
        "-i",
        containerName,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ]);

      const { promise: readyPromise, resolve: resolveReady } = Promise.withResolvers<void>();
      psqlChild.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("ENROLL_READY")) {
          resolveReady();
        }
      });

      try {
        // Send interactive transaction to psql
        psqlChild.stdin.write(`
BEGIN;
SELECT * FROM public.enroll_student(
  '${studentUser.authId}'::uuid,
  '${course.joinCode}',
  '${studentUser.name}',
  '${studentUser.email}'
);
\\echo ENROLL_READY
`);

        await readyPromise;

        // Start commitKnowledgeGraph through service; it will block waiting for SHARE lock
        const nodes = getCanonicalNodes();
        const commitPromise = graphService.commitKnowledgeGraph(
          teacherActor,
          course.courseId,
          nodes,
          FIXTURE_34_EDGES,
        );

        // Wait for lock wait on PostgreSQL
        let waiting = false;
        const lockPollStart = Date.now();
        while (!waiting && Date.now() - lockPollStart < 10000) {
          const { data: locks } = await harness.serviceClient
            .from("courses")
            .select("id")
            .eq("id", course.courseId);
          if (locks) {
            // Check pg_stat_activity
            const statOutput = execFileSync(
              "docker",
              [
                "exec",
                "-i",
                containerName,
                "psql",
                "-U",
                "postgres",
                "-d",
                "postgres",
                "-t",
                "-A",
                "-c",
                "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';",
              ],
              { encoding: "utf8" },
            ).trim();
            if (Number(statOutput) > 0) {
              waiting = true;
            }
          }
          if (!waiting) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }

        // Commit held transaction
        psqlChild.stdin.write("COMMIT;\n");
        await commitPromise;

        // Verify student has 33 initialized mastery rows
        const { data: students } = await harness.serviceClient
          .from("students")
          .select("id")
          .eq("auth_id", studentUser.authId)
          .eq("course_id", course.courseId);
        expect(students).toHaveLength(1);

        const { data: mastery } = await harness.serviceClient
          .from("student_mastery")
          .select("id")
          .eq("student_id", students![0].id);
        expect(mastery).toHaveLength(33);
      } finally {
        try {
          psqlChild.stdin.write("ROLLBACK;\n");
          psqlChild.stdin.end();
        } catch {
          // ignore
        }
        psqlChild.kill();
      }
    });

    it("9. proves function execution denied to anon/authenticated and allowed to service_role", async () => {
      // 1. Database role privileges query
      const checkSql = `
        SELECT 
          has_function_privilege('anon', 'public.commit_knowledge_graph(UUID, UUID, JSONB, JSONB)', 'execute') AS anon_can_exec,
          has_function_privilege('authenticated', 'public.commit_knowledge_graph(UUID, UUID, JSONB, JSONB)', 'execute') AS auth_can_exec,
          has_function_privilege('service_role', 'public.commit_knowledge_graph(UUID, UUID, JSONB, JSONB)', 'execute') AS service_can_exec;
      `;

      const result = execFileSync(
        "docker",
        ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", checkSql],
        { encoding: "utf8" },
      ).trim();

      expect(result).toBe("f|f|t");

      // 2. Direct anonymous RPC call must fail
      const anonResult = await harness.anonClient.rpc("commit_knowledge_graph", {
        p_actor_auth_id: "00000000-0000-0000-0000-000000000000",
        p_course_id: "00000000-0000-0000-0000-000000000000",
        p_nodes: [],
        p_edges: [],
      });

      expect(anonResult.error).not.toBeNull();
      // Should be 42501 permission denied or PGRST301
      expect(["42501", "PGRST301", "PGRST202"]).toContain(anonResult.error?.code);
    });
  },
);
