import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import {
  createPollRouter,
  type PollRouterDependencies,
} from "../../../src/server/classroom/poll-router.js";

describe("Poll Router Unit Tests", () => {
  const lectureId: UUID = "11111111-1111-4111-8111-111111111111";
  const courseId: UUID = "22222222-2222-4222-8222-222222222222";
  const teacherId: UUID = "33333333-3333-4333-8333-333333333333";
  const studentId: UUID = "77777777-7777-4777-8777-777777777777";
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
    enrolledCourses: [{ courseId, studentId }],
  };

  let mockActor: ActorContext = teacherActor;
  let deps: PollRouterDependencies;
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    mockActor = teacherActor;
    deps = {
      auth: {
        verifyToken: vi.fn().mockImplementation(() => Promise.resolve(mockActor)),
      },
      polls: {
        activatePoll: vi.fn().mockResolvedValue({
          id: pollId,
          lectureId,
          conceptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          question: "What is gradient descent?",
          expectedAnswer: "An iterative optimization algorithm.",
          status: "active",
          generatedAt: timestamp,
          activatedAt: timestamp,
        }),
        closePoll: vi.fn().mockResolvedValue({
          id: pollId,
          lectureId,
          conceptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          question: "What is gradient descent?",
          expectedAnswer: "An iterative optimization algorithm.",
          status: "closed",
          generatedAt: timestamp,
          activatedAt: timestamp,
          closedAt: timestamp,
        }),
        respondToPoll: vi.fn().mockResolvedValue({
          responseId: "88888888-8888-4888-8888-888888888888",
          status: "evaluated",
          evaluation: {
            outcome: "correct",
            feedback: "Great work!",
          },
          newConfidence: 0.85,
          newBand: "green",
        }),
      },
      teacherPolls: {
        generatePoll: vi.fn().mockResolvedValue({
          id: pollId,
          lectureId,
          conceptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          question: "What is gradient descent optimization?",
          expectedAnswer: "An iterative first-order optimization algorithm for finding a local minimum.",
          status: "draft",
          generatedAt: timestamp,
        }),
        editDraft: vi.fn().mockResolvedValue({
          id: pollId,
          lectureId,
          conceptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          question: "Updated question text here?",
          expectedAnswer: "Updated expected answer text.",
          status: "draft",
          generatedAt: timestamp,
        }),
        getSnapshot: vi.fn().mockResolvedValue({
          lectureId,
          draft: null,
          active: null,
          closed: null,
        }),
      },
      pollRepo: {
        getPoll: vi.fn().mockResolvedValue({
          poll: {
            id: pollId,
            lectureId,
            conceptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            question: "What is gradient descent?",
            expectedAnswer: "An iterative optimization algorithm.",
            status: "active",
            generatedAt: timestamp,
          },
          courseId,
          lectureStatus: "live",
        }),
      },
    };

    app = express();
    app.use(createPollRouter(deps));

    server = http.createServer(app);
    const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", () => listenResolve());
    await listenPromise;
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      const { promise: closePromise, resolve: closeResolve } = Promise.withResolvers<void>();
      server.close(() => closeResolve());
      await closePromise;
    }
  });

  describe("GET /api/lectures/:lectureId/polls", () => {
    it("returns 200 with TeacherPollSnapshot for authorized teacher", async () => {
      const res = await fetch(`${baseUrl}/api/lectures/${lectureId}/polls`, {
        headers: { Authorization: "Bearer valid-token" },
      });
      const body = (await res.json()) as { lectureId: string };

      expect(res.status).toBe(200);
      expect(body.lectureId).toBe(lectureId);
      expect(deps.teacherPolls.getSnapshot).toHaveBeenCalledWith(teacherActor, lectureId);
    });

    it("returns 403 for student", async () => {
      mockActor = studentActor;
      const res = await fetch(`${baseUrl}/api/lectures/${lectureId}/polls`, {
        headers: { Authorization: "Bearer valid-token" },
      });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/lectures/:lectureId/poll/generate", () => {
    it("returns 201 with created draft poll", async () => {
      const res = await fetch(`${baseUrl}/api/lectures/${lectureId}/poll/generate`, {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { id: string; status: string };

      expect(res.status).toBe(201);
      expect(body.id).toBe(pollId);
      expect(body.status).toBe("draft");
    });
  });

  describe("PATCH /api/polls/:pollId", () => {
    it("returns 200 with updated draft poll", async () => {
      const res = await fetch(`${baseUrl}/api/polls/${pollId}`, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: "Updated question text here?",
          expectedAnswer: "Updated expected answer text.",
        }),
      });
      const body = (await res.json()) as { question: string };

      expect(res.status).toBe(200);
      expect(body.question).toBe("Updated question text here?");
    });

    it("returns 400 on invalid input length", async () => {
      const res = await fetch(`${baseUrl}/api/polls/${pollId}`, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: "Too short",
          expectedAnswer: "Too short",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/polls/:pollId/activate", () => {
    it("returns 200 with activated poll", async () => {
      const res = await fetch(`${baseUrl}/api/polls/${pollId}/activate`, {
        method: "POST",
        headers: { Authorization: "Bearer valid-token" },
      });
      const body = (await res.json()) as { status: string };

      expect(res.status).toBe(200);
      expect(body.status).toBe("active");
    });
  });

  describe("POST /api/polls/:pollId/close", () => {
    it("returns 200 with closed poll", async () => {
      const res = await fetch(`${baseUrl}/api/polls/${pollId}/close`, {
        method: "POST",
        headers: { Authorization: "Bearer valid-token" },
      });
      const body = (await res.json()) as { status: string };

      expect(res.status).toBe(200);
      expect(body.status).toBe("closed");
    });
  });

  describe("POST /api/polls/:pollId/respond", () => {
    it("returns 200 with PollResponseResult for enrolled student", async () => {
      mockActor = studentActor;
      const res = await fetch(`${baseUrl}/api/polls/${pollId}/respond`, {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ answer: "Large learning rate diverges." }),
      });
      const body = (await res.json()) as { status: string; newConfidence: number };

      expect(res.status).toBe(200);
      expect(body.status).toBe("evaluated");
      expect(body.newConfidence).toBe(0.85);
      expect(deps.polls.respondToPoll).toHaveBeenCalledWith(
        studentActor,
        pollId,
        studentId,
        "Large learning rate diverges."
      );
    });

    it("returns 403 when teacher attempts to respond to poll", async () => {
      mockActor = teacherActor;
      const res = await fetch(`${baseUrl}/api/polls/${pollId}/respond`, {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ answer: "My answer." }),
      });

      expect(res.status).toBe(403);
    });
  });
});
