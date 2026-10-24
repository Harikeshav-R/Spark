import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../../../src/contracts/common";
import type { ConceptEdge, ConceptNode } from "../../../src/contracts/course";
import { AppError } from "../../../src/contracts/errors";
import type { StudentMastery } from "../../../src/contracts/mastery";
import {
  GraphRepository,
  GraphService,
} from "../../../src/server/core/index";

const teacherAuthId = "11111111-1111-4111-8111-111111111111";
const teacherId = "22222222-2222-4222-8222-222222222222";
const otherTeacherAuthId = "33333333-3333-4333-8333-333333333333";
const studentAuthId = "44444444-4444-4444-8444-444444444444";
const studentId = "55555555-5555-4555-8555-555555555555";
const courseId = "66666666-6666-4666-8666-666666666666";

const teacherActor: ActorContext = {
  userId: teacherAuthId,
  authId: teacherAuthId,
  name: "Dr. Teacher",
  email: "teacher@stanford.edu",
  role: "teacher",
  teacherId,
  enrolledCourses: [],
};

const otherTeacherActor: ActorContext = {
  userId: otherTeacherAuthId,
  authId: otherTeacherAuthId,
  name: "Dr. Other",
  email: "other@stanford.edu",
  role: "teacher",
  teacherId: "77777777-7777-4777-8777-777777777777",
  enrolledCourses: [],
};

const studentActor: ActorContext = {
  userId: studentAuthId,
  authId: studentAuthId,
  name: "Alice Student",
  email: "alice@stanford.edu",
  role: "student",
  enrolledCourses: [{ studentId, courseId }],
};

const unenrolledStudentActor: ActorContext = {
  userId: "88888888-8888-4888-8888-888888888888",
  authId: "88888888-8888-4888-8888-888888888888",
  name: "Bob Unenrolled",
  email: "bob@stanford.edu",
  role: "student",
  enrolledCourses: [],
};
describe("P2-A-02: GraphService Unit Tests", () => {
  it("enforces actor isolation: rejects calls with mismatched actor or non-teacher commits", async () => {
    const mockRepo = {
      getTopology: vi.fn(),
      commitKnowledgeGraph: vi.fn(),
    };
    const mockMastery = { getMastery: vi.fn() };

    const service = new GraphService(teacherActor, mockRepo, mockMastery);

    // Mismatched actor on commit
    await expect(
      service.commitKnowledgeGraph(otherTeacherActor, courseId, [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.code).toBe("FORBIDDEN");
      expect(appErr.message).toContain("Actor mismatch");
      return true;
    });

    // Mismatched actor on getCourseGraph
    await expect(
      service.getCourseGraph(otherTeacherActor, courseId),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.code).toBe("FORBIDDEN");
      return true;
    });

    // Student attempting commit
    const studentService = new GraphService(studentActor, mockRepo, mockMastery);
    await expect(
      studentService.commitKnowledgeGraph(studentActor, courseId, [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.code).toBe("FORBIDDEN");
      expect(appErr.message).toContain("Only teachers");
      return true;
    });
  });

  it("validates courseId format and graph topology before delegating to repository", async () => {
    const mockRepo = {
      getTopology: vi.fn(),
      commitKnowledgeGraph: vi.fn(),
    };
    const mockMastery = { getMastery: vi.fn() };

    const service = new GraphService(teacherActor, mockRepo, mockMastery);

    // Invalid courseId
    await expect(
      service.commitKnowledgeGraph(teacherActor, "bad-uuid", [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });

    // Cyclic graph
    const nodes = [
      { label: "A", description: "d", category: "c", difficulty: 1 },
      { label: "B", description: "d", category: "c", difficulty: 2 },
    ];
    const cyclicEdges: [string, string][] = [
      ["A", "B"],
      ["B", "A"],
    ];

    await expect(
      service.commitKnowledgeGraph(teacherActor, courseId, nodes, cyclicEdges),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      expect(appErr.message).toContain("cycle");
      return true;
    });

    expect(mockRepo.commitKnowledgeGraph).not.toHaveBeenCalled();
  });

  it("projects teacher and student views accurately without leaking data", async () => {
    const nodeA: ConceptNode = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      courseId,
      label: "Vectors",
      description: "Desc",
      category: "Linear Algebra",
      difficulty: 1,
      createdAt: "2026-10-21T00:00:00.000Z",
    };
    const nodeB: ConceptNode = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      courseId,
      label: "Matrices",
      description: "Desc",
      category: "Linear Algebra",
      difficulty: 2,
      createdAt: "2026-10-21T00:00:00.000Z",
    };
    const edge: ConceptEdge = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      courseId,
      sourceId: nodeA.id,
      targetId: nodeB.id,
      relationship: "prerequisite",
      createdAt: "2026-10-21T00:00:00.000Z",
    };

    const mockRepo = {
      getTopology: vi.fn().mockResolvedValue({
        nodes: [nodeA, nodeB],
        edges: [edge],
      }),
      commitKnowledgeGraph: vi.fn(),
    };

    // 1. Teacher projection: includes importance, but confidence and band are undefined
    const teacherService = new GraphService(teacherActor, mockRepo, { getMastery: vi.fn() });
    const teacherGraph = await teacherService.getCourseGraph(teacherActor, courseId);
    expect(teacherGraph.nodes).toHaveLength(2);
    expect(teacherGraph.nodes[0].importance).toBeGreaterThan(0);
    expect(teacherGraph.nodes[0].confidence).toBeUndefined();
    expect(teacherGraph.nodes[0].band).toBeUndefined();

    // 2. Student projection: merges student's mastery records
    const mockStudentMastery: StudentMastery[] = [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        studentId,
        conceptId: nodeA.id,
        confidence: 0.85,
        attempts: 3,
        version: 2,
        lastUpdated: "2026-10-21T01:00:00.000Z",
      },
    ];
    const studentMasteryMock = {
      getMastery: vi.fn().mockResolvedValue(mockStudentMastery),
    };

    const studentService = new GraphService(studentActor, mockRepo, studentMasteryMock);
    const studentGraph = await studentService.getCourseGraph(studentActor, courseId);
    expect(studentGraph.nodes).toHaveLength(2);

    const projectedNodeA = studentGraph.nodes.find((n) => n.id === nodeA.id);
    expect(projectedNodeA?.confidence).toBe(0.85);
    expect(projectedNodeA?.band).toBe("green");

    // Node B has no mastery record -> confidence and band omitted
    const projectedNodeB = studentGraph.nodes.find((n) => n.id === nodeB.id);
    expect(projectedNodeB?.confidence).toBeUndefined();
    expect(projectedNodeB?.band).toBeUndefined();

    // 3. Unenrolled student: rejected with 403
    const unenrolledService = new GraphService(unenrolledStudentActor, mockRepo, studentMasteryMock);
    await expect(
      unenrolledService.getCourseGraph(unenrolledStudentActor, courseId),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.code).toBe("FORBIDDEN");
      return true;
    });
  });

  it("calculates importance using bound actor topology without querying mastery", async () => {
    const nodeA: ConceptNode = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      courseId,
      label: "A",
      description: "d",
      category: "c",
      difficulty: 1,
      createdAt: "2026-10-21T00:00:00.000Z",
    };
    const mockRepo = {
      getTopology: vi.fn().mockResolvedValue({
        nodes: [nodeA],
        edges: [],
      }),
      commitKnowledgeGraph: vi.fn(),
    };
    const mockMastery = { getMastery: vi.fn() };

    const service = new GraphService(teacherActor, mockRepo, mockMastery);
    const importance = await service.calculateImportance(courseId);

    expect(importance.size).toBe(1);
    expect(mockMastery.getMastery).not.toHaveBeenCalled();
  });
});

describe("P2-A-02: GraphRepository Database Error Mapping", () => {
  const dummyCourse = {
    id: courseId,
    teacherId,
    name: "CS229",
    joinCode: "ABCDEF",
    createdAt: "2026-10-21T00:00:00.000Z",
  };

  it("maps P0001 GRAPH_ALREADY_EXISTS to 409 Conflict", async () => {
    const mockCourses = { getCourse: vi.fn().mockResolvedValue(dummyCourse) };
    const mockClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0001", message: "GRAPH_ALREADY_EXISTS" },
      }),
    };

    const repo = new GraphRepository(mockClient as never, mockCourses as never);
    await expect(
      repo.commitKnowledgeGraph(teacherActor, courseId, [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(409);
      expect(appErr.code).toBe("GRAPH_ALREADY_EXISTS");
      return true;
    });
  });

  it("maps P0001 INVALID_GRAPH: to 422 UNPROCESSABLE_ENTITY", async () => {
    const mockCourses = { getCourse: vi.fn().mockResolvedValue(dummyCourse) };
    const mockClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0001", message: "INVALID_GRAPH: duplicate concept label" },
      }),
    };

    const repo = new GraphRepository(mockClient as never, mockCourses as never);
    await expect(
      repo.commitKnowledgeGraph(teacherActor, courseId, [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      return true;
    });
  });

  it("maps P0002 to 404 NOT_FOUND", async () => {
    const mockCourses = { getCourse: vi.fn().mockResolvedValue(dummyCourse) };
    const mockClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0002", message: "Course not found" },
      }),
    };

    const repo = new GraphRepository(mockClient as never, mockCourses as never);
    await expect(
      repo.commitKnowledgeGraph(teacherActor, courseId, [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(404);
      expect(appErr.code).toBe("NOT_FOUND");
      return true;
    });
  });

  it("maps 42501 to 403 FORBIDDEN", async () => {
    const mockCourses = { getCourse: vi.fn().mockResolvedValue(dummyCourse) };
    const mockClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "Permission denied" },
      }),
    };

    const repo = new GraphRepository(mockClient as never, mockCourses as never);
    await expect(
      repo.commitKnowledgeGraph(teacherActor, courseId, [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.code).toBe("FORBIDDEN");
      return true;
    });
  });

  it("maps 22023 / 22P02 to 400 VALIDATION_ERROR", async () => {
    const mockCourses = { getCourse: vi.fn().mockResolvedValue(dummyCourse) };
    const mockClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "22023", message: "Invalid parameters" },
      }),
    };

    const repo = new GraphRepository(mockClient as never, mockCourses as never);
    await expect(
      repo.commitKnowledgeGraph(teacherActor, courseId, [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });
  });

  it("maps PGRST000/001/002 connection failures to 503 SERVICE_UNAVAILABLE", async () => {
    const mockCourses = { getCourse: vi.fn().mockResolvedValue(dummyCourse) };
    const mockClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST000", message: "Connection refused" },
      }),
    };

    const repo = new GraphRepository(mockClient as never, mockCourses as never);
    await expect(
      repo.commitKnowledgeGraph(teacherActor, courseId, [], []),
    ).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(503);
      expect(appErr.code).toBe("SERVICE_UNAVAILABLE");
      return true;
    });
  });

  it("returns empty topology when course has no committed concept nodes", async () => {
    const mockCourses = { getCourse: vi.fn().mockResolvedValue(dummyCourse) };
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    const mockClient = {
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: vi.fn(),
    };

    const repo = new GraphRepository(mockClient as never, mockCourses as never);
    const topology = await repo.getTopology(teacherActor, courseId);
    expect(topology).toEqual({ nodes: [], edges: [] });
  });
});
