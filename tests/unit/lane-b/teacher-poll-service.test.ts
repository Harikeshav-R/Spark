import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext, Clock, IdGenerator, UUID } from "../../../src/contracts/common.js";
import type { ConceptNode } from "../../../src/contracts/course.js";
import type { PollDraftInput } from "../../../src/contracts/classroom.js";
import {
  TeacherPollService,
  type TeacherPollServiceDependencies,
} from "../../../src/server/classroom/teacher-poll-service.js";

describe("TeacherPollService Unit Tests", () => {
  const lectureId: UUID = "11111111-1111-4111-8111-111111111111";
  const courseId: UUID = "22222222-2222-4222-8222-222222222222";
  const teacherId: UUID = "33333333-3333-4333-8333-333333333333";
  const conceptA: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const conceptB: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const pollId: UUID = "44444444-4444-4444-8444-444444444444";
  const timestamp = "2026-10-23T14:00:00.000Z";

  const teacherActor: ActorContext = {
    userId: "55555555-5555-4555-8555-555555555555",
    authId: "55555555-5555-4555-8555-555555555555",
    email: "teacher@example.edu",
    name: "Prof. Teacher",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: "66666666-6666-4666-8666-666666666666",
    authId: "66666666-6666-4666-8666-666666666666",
    email: "student@example.edu",
    name: "Student",
    role: "student",
    enrolledCourses: [{ courseId, studentId: "77777777-7777-4777-8777-777777777777" }],
  };

  const mockClock: Clock = {
    now: () => new Date(timestamp),
    nowISO: () => timestamp,
  };

  const mockIds: IdGenerator = {
    generateId: () => pollId,
    generateJoinCode: () => "ABCDEF",
  };

  const courseNodes: ConceptNode[] = [
    {
      id: conceptA,
      courseId,
      label: "Gradient Descent",
      category: "Optimization",
      description: "First order optimization",
      difficulty: 1,
      createdAt: timestamp,
    },
    {
      id: conceptB,
      courseId,
      label: "Loss Function",
      category: "Optimization",
      description: "Objective function",
      difficulty: 1,
      createdAt: timestamp,
    },
  ];

  let deps: TeacherPollServiceDependencies;

  beforeEach(() => {
    deps = {
      lectures: {
        getLecture: vi.fn().mockResolvedValue({
          id: lectureId,
          courseId,
          title: "Lecture 1",
          status: "live",
          startedAt: timestamp,
        }),
      },
      rooms: {
        authorizeRoom: vi.fn().mockResolvedValue(undefined),
      },
      graph: {
        getTopology: vi.fn().mockResolvedValue({ nodes: courseNodes }),
      },
      transcripts: {
        getRecentChunks: vi.fn().mockResolvedValue([
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            lectureId,
            text: "Hello world",
            timestampSec: 10,
            detectedConceptIds: [conceptB, conceptA], // B then A, should break tie by A
            createdAt: timestamp,
          },
        ]),
        getRecentTranscriptText: vi.fn().mockResolvedValue("Hello world"),
      },
      ai: {
        generatePollQuestion: vi.fn().mockResolvedValue({
          question: "What is gradient descent and how does it optimize parameters?",
          expectedAnswer: "It is an iterative first-order optimization algorithm for finding a local minimum.",
        }),
      },
      polls: {
        insertDraft: vi.fn().mockImplementation((_actor, poll) => Promise.resolve(poll)),
        updateDraft: vi.fn().mockImplementation((_actor, _id, input) =>
          Promise.resolve({
            id: pollId,
            lectureId,
            conceptId: conceptA,
            question: input.question,
            expectedAnswer: input.expectedAnswer,
            status: "draft",
            generatedAt: timestamp,
          })
        ),
        getLatestPolls: vi.fn().mockResolvedValue({
          lectureId,
          draft: null,
          active: null,
          closed: null,
        }),
      },
      clock: mockClock,
      ids: mockIds,
    };
  });

  it("rejects non-teacher actors with 403 FORBIDDEN", async () => {
    const service = new TeacherPollService(deps);
    await expect(service.generatePoll(studentActor, lectureId)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.editDraft(studentActor, pollId, { question: "Q", expectedAnswer: "A" })
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.getSnapshot(studentActor, lectureId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("generates poll using specified conceptId if valid for course", async () => {
    const service = new TeacherPollService(deps);
    const result = await service.generatePoll(teacherActor, lectureId, conceptB);
    expect(result.conceptId).toBe(conceptB);
    expect(result.status).toBe("draft");
    expect(deps.polls.insertDraft).toHaveBeenCalledWith(teacherActor, expect.objectContaining({
      conceptId: conceptB,
      status: "draft",
    }));
  });

  it("rejects conceptId not belonging to the course with 400 VALIDATION_ERROR", async () => {
    const service = new TeacherPollService(deps);
    const foreignConcept: UUID = "99999999-9999-4999-8999-999999999999";
    await expect(service.generatePoll(teacherActor, lectureId, foreignConcept)).rejects.toMatchObject({
      statusCode: 400,
      message: "Concept does not belong to this course",
    });
  });

  it("chooses first concept from newest chunk with detections, tie-breaking by UUID ascending", async () => {
    const service = new TeacherPollService(deps);
    // Chunk had [conceptB, conceptA]. conceptA < conceptB lexicographically.
    const result = await service.generatePoll(teacherActor, lectureId);
    expect(result.conceptId).toBe(conceptA);
  });

  it("fails with 400 VALIDATION_ERROR when no transcript detections exist", async () => {
    deps.transcripts.getRecentChunks = vi.fn().mockResolvedValue([]);
    const service = new TeacherPollService(deps);
    await expect(service.generatePoll(teacherActor, lectureId)).rejects.toMatchObject({
      statusCode: 400,
      message: "Select a concept or wait for lecture concept detection.",
    });
  });

  it("rechecks lecture status after AI completes and rejects if completed", async () => {
    let callCount = 0;
    deps.lectures.getLecture = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        id: lectureId,
        courseId,
        title: "Lecture 1",
        status: callCount === 1 ? "live" : "completed",
        startedAt: timestamp,
      });
    });

    const service = new TeacherPollService(deps);
    await expect(service.generatePoll(teacherActor, lectureId)).rejects.toMatchObject({
      statusCode: 400,
      message: "Lecture ended before poll draft could be generated",
    });
  });

  it("edits draft poll through repository", async () => {
    const service = new TeacherPollService(deps);
    const input: PollDraftInput = {
      question: "Updated question text here?",
      expectedAnswer: "Updated expected answer text.",
    };
    const result = await service.editDraft(teacherActor, pollId, input);
    expect(result.question).toBe(input.question);
    expect(result.expectedAnswer).toBe(input.expectedAnswer);
  });

  it("returns latest polls snapshot for authorized teacher", async () => {
    const service = new TeacherPollService(deps);
    const snapshot = await service.getSnapshot(teacherActor, lectureId);
    expect(snapshot.lectureId).toBe(lectureId);
    expect(deps.rooms.authorizeRoom).toHaveBeenCalledWith(teacherActor, `professor:${lectureId}`);
  });
});
