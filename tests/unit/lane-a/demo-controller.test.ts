import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../../src/contracts/errors.js";
import type { ActorContext, Clock } from "../../../src/contracts/common.js";
import {
  DemoController,
  type DemoControllerDependencies,
} from "../../../src/server/platform/demo/controller.js";
import { demoId } from "../../../src/server/platform/demo/dataset.js";
import { FIXTURE_COURSE_ID } from "../../../src/server/ai/index.js";
import { CS229_TRANSCRIPT_SCRIPT } from "../../../src/server/classroom/cs229-transcript.js";

function createMockDeps(overrides: Partial<DemoControllerDependencies> = {}): DemoControllerDependencies {
  const clock: Clock = {
    now: () => new Date("2026-10-24T12:00:00.000Z"),
    nowISO: () => "2026-10-24T12:00:00.000Z",
  };

  return {
    config: {
      origin: "http://localhost:3000",
      supabaseUrl: "http://127.0.0.1:54321",
      dbContainer: "supabase_db_HackOHIO-2026",
      tickRateMs: 4000,
      autoRespond: false,
    },
    env: {
      NODE_ENV: "test",
      DEMO_MODE: "true",
      LECTURE_SOURCE: "simulator",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      CREDENTIAL_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    auth: {
      verifyToken: vi.fn(),
    },
    courses: {
      getCourse: vi.fn().mockResolvedValue({
        id: FIXTURE_COURSE_ID,
        teacherId: demoId("teacher:chen"),
        name: "CS229",
        joinCode: "CS229-8F",
      }),
    },
    lectures: {
      listLectures: vi.fn().mockResolvedValue([]),
      getLecture: vi.fn().mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        courseId: FIXTURE_COURSE_ID,
        title: "CS229 Live",
        status: "live",
      }),
    },
    polls: {
      getPoll: vi.fn(),
    },
    pollService: {
      respondToPoll: vi.fn(),
    },
    speech: {
      stop: vi.fn().mockResolvedValue(undefined),
    },
    transcripts: {
      ingestTranscriptChunk: vi.fn().mockResolvedValue({
        id: "chunk-1",
        lectureId: "22222222-2222-4222-8222-222222222222",
        text: "test",
        timestampSec: 0,
      }),
    },
    transcriptRepo: {
      getLectureTranscript: vi.fn().mockResolvedValue([]),
    },
    availability: {
      registerAvailability: vi.fn().mockResolvedValue(undefined),
    },
    studyGroups: {
      optIntoPool: vi.fn(),
    },
    heatmap: {
      afterEvidenceApplied: vi.fn().mockResolvedValue(undefined),
    },
    presence: {
      leave: vi.fn().mockResolvedValue(undefined),
      getAttendingStudentIds: vi.fn().mockReturnValue([]),
    },
    io: {
      fetchSockets: vi.fn().mockResolvedValue([]),
    } as unknown as DemoControllerDependencies["io"],
    databaseClient: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    } as unknown as DemoControllerDependencies["databaseClient"],
    clock,
    ...overrides,
  };
}

const chenActor: ActorContext = {
  userId: demoId("auth:teacher"),
  authId: demoId("auth:teacher"),
  teacherId: demoId("teacher:chen"),
  name: "Prof. Sarah Chen",
  email: "sarah.chen@example.test",
  role: "teacher",
  enrolledCourses: [],
};

const studentActor: ActorContext = {
  userId: demoId("auth:hari"),
  authId: demoId("auth:hari"),
  name: "Hari",
  email: "hari@example.test",
  role: "student",
  enrolledCourses: [
    {
      courseId: FIXTURE_COURSE_ID,
      studentId: demoId("student:hari"),
    },
  ],
};

describe("DemoController", () => {
  it("getState returns course state with null lecture when no lectures are live", async () => {
    const deps = createMockDeps();
    const controller = new DemoController(deps);

    const state = await controller.getState(chenActor);
    expect(state.courseId).toBe(FIXTURE_COURSE_ID);
    expect(state.lectureId).toBeNull();
    expect(state.activePollId).toBeNull();
    expect(state.speech.playing).toBe(false);
    expect(state.speech.total).toBe(CS229_TRANSCRIPT_SCRIPT.length);
  });

  it("getState returns live lecture and active poll when present", async () => {
    const deps = createMockDeps({
      lectures: {
        listLectures: vi.fn().mockResolvedValue([
          {
            id: "22222222-2222-4222-8222-222222222222",
            courseId: FIXTURE_COURSE_ID,
            title: "Live Lecture",
            status: "live",
          },
        ]),
        getLecture: vi.fn(),
      },
      databaseClient: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "poll-1111-2222-3333-444444444444" },
            error: null,
          }),
        }),
      } as unknown as DemoControllerDependencies["databaseClient"],
    });

    const controller = new DemoController(deps);
    const state = await controller.getState(studentActor);
    expect(state.lectureId).toBe("22222222-2222-4222-8222-222222222222");
    expect(state.activePollId).toBe("poll-1111-2222-3333-444444444444");
  });

  it("rejects speech control from non-Chen actor", async () => {
    const deps = createMockDeps();
    const controller = new DemoController(deps);

    await expect(
      controller.controlSpeech(studentActor, {
        lectureId: "22222222-2222-4222-8222-222222222222",
        action: "step",
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects speech controls when LECTURE_SOURCE=zoom", async () => {
    const deps = createMockDeps({
      env: {
        NODE_ENV: "test",
        DEMO_MODE: "true",
        LECTURE_SOURCE: "zoom",
      },
    });
    const controller = new DemoController(deps);

    await expect(
      controller.controlSpeech(chenActor, {
        lectureId: "22222222-2222-4222-8222-222222222222",
        action: "step",
      }),
    ).rejects.toThrow(/zoom/i);
  });

  it("step advances speech cursor and calls ingestTranscriptChunk", async () => {
    const deps = createMockDeps();
    const controller = new DemoController(deps);

    const result = await controller.controlSpeech(chenActor, {
      lectureId: "22222222-2222-4222-8222-222222222222",
      action: "step",
    });

    expect(result.nextIndex).toBe(1);
    expect(result.playing).toBe(false);
    expect(deps.transcripts.ingestTranscriptChunk).toHaveBeenCalledTimes(1);
  });

  it("speed action updates playback speed for valid speeds (1, 2, 5)", async () => {
    const deps = createMockDeps();
    const controller = new DemoController(deps);

    const res2 = await controller.controlSpeech(chenActor, {
      lectureId: "22222222-2222-4222-8222-222222222222",
      action: "speed",
      speed: 2,
    });
    expect(res2.speed).toBe(2);

    const res5 = await controller.controlSpeech(chenActor, {
      lectureId: "22222222-2222-4222-8222-222222222222",
      action: "speed",
      speed: 5,
    });
    expect(res5.speed).toBe(5);
  });

  it("rejects invalid speed parameter", async () => {
    const deps = createMockDeps();
    const controller = new DemoController(deps);

    await expect(
      controller.controlSpeech(chenActor, {
        lectureId: "22222222-2222-4222-8222-222222222222",
        action: "speed",
        // @ts-expect-error test invalid speed
        speed: 3,
      }),
    ).rejects.toThrow(AppError);
  });

  it("pause stops timer and sets playing to false", async () => {
    const deps = createMockDeps();
    const controller = new DemoController(deps);

    await controller.controlSpeech(chenActor, {
      lectureId: "22222222-2222-4222-8222-222222222222",
      action: "play",
    });

    const paused = await controller.controlSpeech(chenActor, {
      lectureId: "22222222-2222-4222-8222-222222222222",
      action: "pause",
    });

    expect(paused.playing).toBe(false);
  });

  it("step throws 409 CONFLICT if playback is currently active", async () => {
    const deps = createMockDeps();
    const controller = new DemoController(deps);

    await controller.controlSpeech(chenActor, {
      lectureId: "22222222-2222-4222-8222-222222222222",
      action: "play",
    });

    await expect(
      controller.controlSpeech(chenActor, {
        lectureId: "22222222-2222-4222-8222-222222222222",
        action: "step",
      }),
    ).rejects.toThrow(AppError);

    controller.dispose();
  });
});
