import { describe, it, expect, vi } from "vitest";
import type { ActorContext, Clock, IdGenerator, UUID } from "../../../src/contracts/common.js";
import type { RealtimePublisher } from "../../../src/contracts/realtime.js";
import { AppError } from "../../../src/contracts/errors.js";
import {
  MessagingRepository,
  MessagingService,
} from "../../../src/server/study-groups/index.js";
import { createFixtureSupabaseClient } from "../../integration/lane-b/helpers/socket-fixture.js";

class TestClock implements Clock {
  currentTime: Date;
  constructor(iso = "2026-10-24T12:00:00.000Z") {
    this.currentTime = new Date(iso);
  }
  now(): Date {
    return this.currentTime;
  }
  nowISO(): string {
    return this.currentTime.toISOString();
  }
  advance(ms: number) {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

class TestIdGenerator implements IdGenerator {
  private counter = 0;
  private prefix = "99999999-9999-4999-8999-";
  generateId(): UUID {
    this.counter++;
    return `${this.prefix}${this.counter.toString(16).padStart(12, "0")}`;
  }
  generateJoinCode(): string {
    return "ABC123";
  }
}

describe("P6-B-02: MessagingService Unit Tests", () => {
  const courseId1 = "11111111-1111-4111-8111-111111111111";
  const courseId2 = "11111111-1111-4111-8111-111111111112";

  const studentId1 = "22222222-2222-4222-8222-222222222221";
  const studentAuthId1 = "33333333-3333-4333-8333-333333333331";

  const studentId2 = "22222222-2222-4222-8222-222222222222";
  const studentAuthId2 = "33333333-3333-4333-8333-333333333332";

  const studentId3 = "22222222-2222-4222-8222-222222222223";
  const studentAuthId3 = "33333333-3333-4333-8333-333333333333";

  // Multi-course student identity: student1 enrolled in course1 as studentId1 and course2 as studentId1Alt
  const studentId1Alt = "22222222-2222-4222-8222-222222222224";

  const matchId1 = "44444444-4444-4444-8444-444444444441";
  const matchId2 = "44444444-4444-4444-8444-444444444442";

  const actorStudent1: ActorContext = {
    userId: studentAuthId1,
    authId: studentAuthId1,
    role: "student",
    name: "Ada Lovelace",
    email: "ada@example.edu",
    enrolledCourses: [
      { studentId: studentId1, courseId: courseId1 },
      { studentId: studentId1Alt, courseId: courseId2 },
    ],
  };

  const actorStudent2: ActorContext = {
    userId: studentAuthId2,
    authId: studentAuthId2,
    role: "student",
    name: "Charles Babbage",
    email: "babbage@example.edu",
    enrolledCourses: [{ studentId: studentId2, courseId: courseId1 }],
  };

  const actorStudent3Outsider: ActorContext = {
    userId: studentAuthId3,
    authId: studentAuthId3,
    role: "student",
    name: "Outsider Student",
    email: "outsider@example.edu",
    enrolledCourses: [{ studentId: studentId3, courseId: courseId1 }],
  };

  const actorTeacher: ActorContext = {
    userId: "55555555-5555-4555-8555-555555555555",
    authId: "55555555-5555-4555-8555-555555555555",
    role: "teacher",
    teacherId: "66666666-6666-4666-8666-666666666666",
    name: "Prof. Euler",
    email: "euler@example.edu",
    enrolledCourses: [],
  };

  function setupTestHarness(initialMessages: Record<string, unknown>[] = []) {
    const fixtureDb = createFixtureSupabaseClient({
      tableRows: {
        students: [
          { id: studentId1, auth_id: studentAuthId1, course_id: courseId1 },
          { id: studentId1Alt, auth_id: studentAuthId1, course_id: courseId2 },
          { id: studentId2, auth_id: studentAuthId2, course_id: courseId1 },
          { id: studentId3, auth_id: studentAuthId3, course_id: courseId1 },
        ],
        study_group_matches: [
          {
            id: matchId1,
            course_id: courseId1,
            student1_id: studentId1,
            student2_id: studentId2,
            concept_ids: ["77777777-7777-4777-8777-777777777777"],
            status: "active",
          },
          {
            id: matchId2,
            course_id: courseId2,
            student1_id: studentId1Alt,
            student2_id: studentId3,
            concept_ids: ["77777777-7777-4777-8777-777777777777"],
            status: "active",
          },
        ],
        study_group_messages: initialMessages,
      },
    });

    const repository = new MessagingRepository(fixtureDb);
    const publisher: RealtimePublisher = {
      emitToLecture: vi.fn(async () => {}),
      emitToTeacher: vi.fn(async () => {}),
      emitToStudent: vi.fn(async () => {}),
      emitToStudyGroup: vi.fn(async () => {}),
    };
    const clock = new TestClock();
    const ids = new TestIdGenerator();

    const service = new MessagingService({
      repository,
      publisher,
      clock,
      ids,
    });

    return { fixtureDb, repository, publisher, clock, ids, service };
  }

  it("persists message and emits study-group:message event to match room", async () => {
    const { service, publisher } = setupTestHarness();

    const result = await service.sendMessage(
      actorStudent1,
      matchId1,
      "Hello! Want to work through chapter 4?",
    );

    expect(result).toMatchObject({
      senderId: studentId1,
      content: "Hello! Want to work through chapter 4?",
      createdAt: "2026-10-24T12:00:00.000Z",
    });
    expect(result.id).toBeDefined();

    expect(publisher.emitToStudyGroup).toHaveBeenCalledTimes(1);
    expect(publisher.emitToStudyGroup).toHaveBeenCalledWith(
      matchId1,
      "study-group:message",
      expect.objectContaining({
        messageId: result.id,
        matchId: matchId1,
        senderId: studentId1,
        content: "Hello! Want to work through chapter 4?",
        occurredAt: result.createdAt,
      }),
    );

    const reply = await service.sendMessage(
      actorStudent2,
      matchId1,
      "Sounds great, let's do it!",
    );
    expect(reply.senderId).toBe(studentId2);
    expect(reply.content).toBe("Sounds great, let's do it!");
  });

  it("fails persistence if content is empty and emits no event", async () => {
    const { service, publisher } = setupTestHarness();

    await expect(
      service.sendMessage(actorStudent1, matchId1, ""),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: "Message content must be a non-empty string",
    });

    expect(publisher.emitToStudyGroup).not.toHaveBeenCalled();
  });

  it("does not emit event if repository persistence fails", async () => {
    const { service, repository, publisher } = setupTestHarness();

    vi.spyOn(repository, "insertMessage").mockRejectedValueOnce(
      new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Database connection failed",
      }),
    );

    await expect(
      service.sendMessage(actorStudent1, matchId1, "Should fail before emit"),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
    });

    expect(publisher.emitToStudyGroup).not.toHaveBeenCalled();
  });

  it("publisher failure propagates error while committed message remains in history", async () => {
    const { service, publisher } = setupTestHarness();

    vi.spyOn(publisher, "emitToStudyGroup").mockRejectedValueOnce(
      new Error("WebSocket transport broke"),
    );

    await expect(
      service.sendMessage(actorStudent1, matchId1, "Committed despite socket drop"),
    ).rejects.toThrow("WebSocket transport broke");

    // History is recovery: the message was already committed to PostgreSQL
    const history = await service.getMatchMessages(actorStudent1, matchId1);
    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe("Committed despite socket drop");
  });

  it("resolves the correct course-scoped studentId for multi-course student", async () => {
    const { service } = setupTestHarness();

    // actorStudent1 in matchId2 (which is in courseId2) should resolve senderId = studentId1Alt
    const message = await service.sendMessage(
      actorStudent1,
      matchId2,
      "Hello from course 2",
    );

    expect(message.senderId).toBe(studentId1Alt);
  });

  it("denies non-member student from reading messages (403)", async () => {
    const { service } = setupTestHarness();

    await expect(
      service.getMatchMessages(actorStudent3Outsider, matchId1),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Forbidden study group access",
    });
  });

  it("denies non-member student from sending messages (403)", async () => {
    const { service, publisher } = setupTestHarness();

    await expect(
      service.sendMessage(actorStudent3Outsider, matchId1, "Intruder message"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Forbidden study group access",
    });

    expect(publisher.emitToStudyGroup).not.toHaveBeenCalled();
  });

  it("denies teacher actor from reading or sending messages (403)", async () => {
    const { service, publisher } = setupTestHarness();

    await expect(
      service.getMatchMessages(actorTeacher, matchId1),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });

    await expect(
      service.sendMessage(actorTeacher, matchId1, "Teacher message"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });

    expect(publisher.emitToStudyGroup).not.toHaveBeenCalled();
  });

  it("returns empty array for authorized match with no messages", async () => {
    const { service } = setupTestHarness();

    const messages = await service.getMatchMessages(actorStudent1, matchId1);
    expect(messages).toEqual([]);
  });

  it("retrieves messages in chronological order and handles pagination across 1,000+ messages", async () => {
    // Seed 1,005 messages
    const bulkMessages: Record<string, unknown>[] = [];
    const baseDate = new Date("2026-10-24T10:00:00.000Z").getTime();

    for (let i = 0; i < 1005; i++) {
      bulkMessages.push({
        id: `88888888-8888-4888-8888-${i.toString(16).padStart(12, "0")}`,
        match_id: matchId1,
        sender_id: i % 2 === 0 ? studentId1 : studentId2,
        content: `Message #${i}`,
        created_at: new Date(baseDate + i * 1000).toISOString(),
      });
    }

    const { service } = setupTestHarness(bulkMessages);

    const history = await service.getMatchMessages(actorStudent1, matchId1);
    expect(history).toHaveLength(1005);
    expect(history[0]?.content).toBe("Message #0");
    expect(history[1004]?.content).toBe("Message #1004");

    // Check chronological order
    for (let i = 1; i < history.length; i++) {
      const prev = new Date(history[i - 1]!.createdAt).getTime();
      const curr = new Date(history[i]!.createdAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("breaks created_at ties in history using id ascending", async () => {
    const sameTimestamp = "2026-10-24T12:00:00.000Z";
    const messages = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        match_id: matchId1,
        sender_id: studentId2,
        content: "Second by ID",
        created_at: sameTimestamp,
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        match_id: matchId1,
        sender_id: studentId1,
        content: "First by ID",
        created_at: sameTimestamp,
      },
    ];

    const { service } = setupTestHarness(messages);

    const history = await service.getMatchMessages(actorStudent1, matchId1);
    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(history[1]?.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
