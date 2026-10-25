import { io as createSocketClient, type Socket as ClientSocket } from "socket.io-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { AppError, DomainErrorCode } from "../../../contracts/errors.js";
import type { ActorContext, Clock } from "../../../contracts/common.js";
import type { TimeInterval } from "../../../contracts/classroom.js";
import type { CourseService, HeatmapService } from "../../core/index.js";
import type {
  LectureRepository,
  PollRepository,
  PollService,
  LectureSpeechService,
  TranscriptIngestor,
  TranscriptRepository,
} from "../../classroom/index.js";
import { CS229_TRANSCRIPT_SCRIPT } from "../../classroom/cs229-transcript.js";
import type { AvailabilityService } from "../../study-groups/availability-service.js";
import type { StudyGroupService } from "../../study-groups/study-group-service.js";
import type { AuthGateway } from "../auth.js";
import type { PresenceTracker } from "../../realtime/presence-tracker.js";
import type { RealtimeSocketServer } from "../../realtime/socket-server.js";
import type { DemoConfig } from "./config.js";
import { demoId, DEMO_PASSWORD } from "./dataset.js";
import { resetDemoDatabase, type DemoSeedResult } from "./seed-store.js";
import { FIXTURE_COURSE_ID } from "../../ai/index.js";

export interface DemoControllerDependencies {
  config: DemoConfig;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  auth: Pick<AuthGateway, "verifyToken">;
  courses: Pick<CourseService, "getCourse">;
  lectures: Pick<LectureRepository, "listLectures" | "getLecture">;
  polls: Pick<PollRepository, "getPoll">;
  pollService: Pick<PollService, "respondToPoll">;
  speech: Pick<LectureSpeechService, "stop">;
  transcripts: Pick<TranscriptIngestor, "ingestTranscriptChunk">;
  transcriptRepo: Pick<TranscriptRepository, "getLectureTranscript">;
  availability: Pick<AvailabilityService, "registerAvailability">;
  studyGroups: Pick<StudyGroupService, "optIntoPool">;
  heatmap: Pick<HeatmapService, "afterEvidenceApplied">;
  presence: Pick<PresenceTracker, "leave" | "getAttendingStudentIds">;
  io: RealtimeSocketServer;
  databaseClient: SupabaseClient;
  clock: Clock;
}

export interface DemoStateDTO {
  courseId: string;
  lectureId: string | null;
  activePollId: string | null;
  speech: {
    playing: boolean;
    speed: number;
    nextIndex: number;
    total: number;
  };
  lastError: string | null;
}

export interface DemoSpeechControlInput {
  lectureId: string;
  action: "play" | "pause" | "step" | "speed";
  speed?: 1 | 2 | 5;
}

export interface DemoSpeechStateDTO {
  lectureId: string;
  playing: boolean;
  speed: number;
  nextIndex: number;
  total: number;
}

export class DemoController {
  private readonly chenTeacherId = demoId("teacher:chen");
  private readonly chenAuthId = demoId("auth:teacher");
  private readonly hariStudentId = demoId("student:hari");
  private readonly rahulStudentId = demoId("student:rahul");
  private readonly vectorsConceptId = "33333333-3333-4333-8333-333333333301";
  private readonly backpropConceptId = "33333333-3333-4333-8333-333333333323";

  private speechPlaying = false;
  private speechSpeed: 1 | 2 | 5 = 1;
  private speechCursor = 0;
  private speechTimer: NodeJS.Timeout | null = null;
  private inFlightSpeechPromise: Promise<void> | null = null;
  private controlledLectureId: string | null = null;

  private lastError: string | null = null;
  private inMaintenance = false;
  private activeBackgroundJobs = new Set<Promise<unknown>>();

  constructor(private readonly deps: DemoControllerDependencies) {}

  isMaintenanceActive(): boolean {
    return this.inMaintenance;
  }

  private assertChenTeacher(actor: ActorContext): void {
    if (
      actor.role !== "teacher" ||
      actor.authId !== this.chenAuthId ||
      actor.teacherId !== this.chenTeacherId
    ) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Only Prof. Sarah Chen can perform demo management actions",
      });
    }
  }

  private async assertDemoCourseAccess(actor: ActorContext): Promise<void> {
    await this.deps.courses.getCourse(actor, FIXTURE_COURSE_ID);
  }

  async getState(actor: ActorContext): Promise<DemoStateDTO> {
    await this.assertDemoCourseAccess(actor);

    // List lectures to find newest live lecture
    const allLectures = await this.deps.lectures.listLectures(FIXTURE_COURSE_ID);
    const liveLecture = allLectures.find((l) => l.status === "live") ?? null;

    let activePollId: string | null = null;
    if (liveLecture) {
      try {
        const { data: pollRow } = await this.deps.databaseClient
          .from("poll_questions")
          .select("id")
          .eq("lecture_id", liveLecture.id)
          .eq("status", "active")
          .maybeSingle();

        if (pollRow?.id) {
          activePollId = pollRow.id;
        }
      } catch {
        // Leave activePollId as null on lookup failure
      }
    }

    return {
      courseId: FIXTURE_COURSE_ID,
      lectureId: liveLecture?.id ?? null,
      activePollId,
      speech: {
        playing: this.speechPlaying,
        speed: this.speechSpeed,
        nextIndex: this.speechCursor,
        total: CS229_TRANSCRIPT_SCRIPT.length,
      },
      lastError: this.lastError,
    };
  }

  async controlSpeech(
    actor: ActorContext,
    input: DemoSpeechControlInput,
  ): Promise<DemoSpeechStateDTO> {
    this.assertChenTeacher(actor);
    await this.assertDemoCourseAccess(actor);

    if (this.deps.env.LECTURE_SOURCE === "zoom") {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Demo speech controls are unavailable when LECTURE_SOURCE=zoom",
      });
    }

    const lecture = await this.deps.lectures.getLecture(input.lectureId);
    if (lecture.courseId !== FIXTURE_COURSE_ID || lecture.status !== "live") {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Target lecture must be an active live demo lecture",
      });
    }

    // Stop ordinary speech service for this lecture if running
    await this.deps.speech.stop(input.lectureId);

    // Initialize cursor from persisted chunks if lecture switched or cursor uninitialized
    if (this.controlledLectureId !== input.lectureId) {
      this.stopSpeechTimer();
      this.controlledLectureId = input.lectureId;
      const existingChunks = await this.deps.transcriptRepo.getLectureTranscript(input.lectureId);
      this.speechCursor = Math.min(existingChunks.length, CS229_TRANSCRIPT_SCRIPT.length);
    }

    if (input.action === "speed") {
      if (!input.speed || ![1, 2, 5].includes(input.speed)) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Speed action requires speed parameter to be 1, 2, or 5",
        });
      }
      this.speechSpeed = input.speed;
      if (this.speechPlaying) {
        this.scheduleNextSpeechTick(actor, input.lectureId);
      }
    } else if (input.action === "step") {
      if (this.speechPlaying) {
        throw new AppError({
          code: DomainErrorCode.CONFLICT,
          statusCode: 409,
          message: "Cannot step while playback is actively playing",
        });
      }
      await this.stepSpeechChunk(actor, input.lectureId);
    } else if (input.action === "play") {
      if (!this.speechPlaying) {
        this.speechPlaying = true;
        this.scheduleNextSpeechTick(actor, input.lectureId);
      }
    } else if (input.action === "pause") {
      this.stopSpeechTimer();
      this.speechPlaying = false;
      if (this.inFlightSpeechPromise) {
        await this.inFlightSpeechPromise;
      }
    }

    return {
      lectureId: input.lectureId,
      playing: this.speechPlaying,
      speed: this.speechSpeed,
      nextIndex: this.speechCursor,
      total: CS229_TRANSCRIPT_SCRIPT.length,
    };
  }

  private stopSpeechTimer(): void {
    if (this.speechTimer) {
      clearTimeout(this.speechTimer);
      this.speechTimer = null;
    }
  }

  private scheduleNextSpeechTick(actor: ActorContext, lectureId: string): void {
    this.stopSpeechTimer();
    if (!this.speechPlaying) return;

    if (this.speechCursor >= CS229_TRANSCRIPT_SCRIPT.length) {
      this.speechPlaying = false;
      return;
    }

    const intervalMs = Math.max(100, Math.floor(this.deps.config.tickRateMs / this.speechSpeed));
    this.speechTimer = setTimeout(() => {
      this.inFlightSpeechPromise = (async () => {
        try {
          if (!this.speechPlaying) return;
          await this.stepSpeechChunk(actor, lectureId);
          if (this.speechPlaying && this.speechCursor < CS229_TRANSCRIPT_SCRIPT.length) {
            this.scheduleNextSpeechTick(actor, lectureId);
          } else {
            this.speechPlaying = false;
          }
        } catch (err: unknown) {
          this.speechPlaying = false;
          this.lastError = err instanceof Error ? err.message : String(err);
          console.error("[DemoController] Speech playback error:", err);
        } finally {
          this.inFlightSpeechPromise = null;
        }
      })();
    }, intervalMs);
  }

  private async stepSpeechChunk(actor: ActorContext, lectureId: string): Promise<void> {
    if (this.speechCursor >= CS229_TRANSCRIPT_SCRIPT.length) {
      return;
    }

    const chunk = CS229_TRANSCRIPT_SCRIPT[this.speechCursor]!;
    await this.deps.transcripts.ingestTranscriptChunk(
      actor,
      lectureId,
      chunk.text,
      chunk.timestampSec,
      chunk.speakerName,
      { isSimulated: true },
    );
    this.speechCursor += 1;
  }

  private async getStudentActorAndToken(
    email: string,
  ): Promise<{ token: string; actor: ActorContext; studentId: string }> {
    const anonKey = this.deps.env.SUPABASE_ANON_KEY;
    if (!anonKey) {
      throw new Error("SUPABASE_ANON_KEY required for demo student login");
    }

    const authClient = createClient(this.deps.config.supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email,
      password: DEMO_PASSWORD,
    });

    if (authError || !authData.session?.access_token) {
      throw new Error(`Failed to sign in demo student ${email}: ${authError?.message}`);
    }

    const token = authData.session.access_token;
    const actor = await this.deps.auth.verifyToken(token);
    const enrollment = actor.enrolledCourses?.find((e) => e.courseId === FIXTURE_COURSE_ID);
    if (!enrollment?.studentId) {
      throw new Error(`Student ${email} is not enrolled in demo course`);
    }

    return { token, actor, studentId: enrollment.studentId };
  }

  async submitPollResponses(
    actor: ActorContext,
    pollId: string,
  ): Promise<{ submitted: string[] }> {
    this.assertChenTeacher(actor);
    await this.assertDemoCourseAccess(actor);

    // Verify poll exists and is active
    const pollCtx = await this.deps.polls.getPoll(actor, pollId);
    if (pollCtx.poll.status !== "active") {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Target poll is not currently active",
      });
    }

    const lectureId = pollCtx.poll.lectureId;

    // 1. Hari response
    const hari = await this.getStudentActorAndToken("hari@example.test");
    const hariAnswer =
      "An excessive learning rate causes updates to overshoot the minimum and diverge.";
    await this.sendPollResponseWithPresence(
      hari.token,
      hari.actor,
      lectureId,
      pollId,
      hari.studentId,
      hariAnswer,
    );

    // 2. Rahul response
    const rahul = await this.getStudentActorAndToken("rahul@example.test");
    const rahulAnswer = "The learning rate has no effect on parameter updates.";
    await this.sendPollResponseWithPresence(
      rahul.token,
      rahul.actor,
      lectureId,
      pollId,
      rahul.studentId,
      rahulAnswer,
    );

    return { submitted: ["hari", "rahul"] };
  }

  private async sendPollResponseWithPresence(
    token: string,
    studentActor: ActorContext,
    lectureId: string,
    pollId: string,
    studentId: string,
    answer: string,
  ): Promise<void> {
    const socket: ClientSocket = createSocketClient(this.deps.config.origin, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });

    try {
      // Connect socket
      const { promise: connectPromise, resolve: connectResolve, reject: connectReject } =
        Promise.withResolvers<void>();
      const timeout = setTimeout(() => connectReject(new Error("Socket connect timeout")), 5000);
      socket.once("connect", () => {
        clearTimeout(timeout);
        connectResolve();
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timeout);
        connectReject(err);
      });
      await connectPromise;

      // Join lecture presence
      const { promise: joinPromise, resolve: joinResolve, reject: joinReject } =
        Promise.withResolvers<void>();
      socket.emit(
        "lecture:join",
        { lectureId },
        (res: { success: boolean; error?: string } | undefined) => {
          if (res?.success) joinResolve();
          else joinReject(new Error(res?.error ?? "lecture:join ack failed"));
        },
      );
      await joinPromise;

      // Submit poll response
      await this.deps.pollService.respondToPoll(studentActor, pollId, studentId, answer);
    } finally {
      try {
        const { promise: leavePromise, resolve: leaveResolve } = Promise.withResolvers<void>();
        socket.emit("lecture:leave", { lectureId }, () => leaveResolve());
        await Promise.race([leavePromise, new Promise((r) => setTimeout(r, 1000))]);
      } catch {
        // Ignore leave ack errors during teardown
      }
      socket.disconnect();
    }
  }

  async instantMatch(actor: ActorContext): Promise<{ matchId: string }> {
    this.assertChenTeacher(actor);
    await this.assertDemoCourseAccess(actor);

    // Preflight: check if an active match between Hari and Rahul already exists
    const [id1, id2] =
      this.hariStudentId < this.rahulStudentId
        ? [this.hariStudentId, this.rahulStudentId]
        : [this.rahulStudentId, this.hariStudentId];

    const { data: existingMatch } = await this.deps.databaseClient
      .from("study_group_matches")
      .select("id")
      .eq("course_id", FIXTURE_COURSE_ID)
      .eq("student1_id", id1)
      .eq("student2_id", id2)
      .eq("status", "active")
      .maybeSingle();

    if (existingMatch?.id) {
      return { matchId: existingMatch.id };
    }

    // Sign in Hari and Rahul
    const hari = await this.getStudentActorAndToken("hari@example.test");
    const rahul = await this.getStudentActorAndToken("rahul@example.test");

    // Tomorrow 15:00–15:30 UTC
    const dMidnight = new Date();
    dMidnight.setUTCHours(0, 0, 0, 0);
    const tomorrowStart = new Date(dMidnight.getTime() + 86400000 + 15 * 3600000);
    const tomorrowEnd = new Date(tomorrowStart.getTime() + 30 * 60000);

    const intervals: TimeInterval[] = [
      {
        startsAt: tomorrowStart.toISOString(),
        endsAt: tomorrowEnd.toISOString(),
      },
    ];

    // Register availability
    await this.deps.availability.registerAvailability(hari.actor, FIXTURE_COURSE_ID, intervals);
    await this.deps.availability.registerAvailability(rahul.actor, FIXTURE_COURSE_ID, intervals);

    // Opt into pool on Backpropagation
    await this.deps.studyGroups.optIntoPool(hari.actor, FIXTURE_COURSE_ID, [this.backpropConceptId]);
    const rahulOptIn = await this.deps.studyGroups.optIntoPool(rahul.actor, FIXTURE_COURSE_ID, [
      this.backpropConceptId,
    ]);

    if (rahulOptIn.status !== "matched" || !rahulOptIn.matchId) {
      throw new Error("Instant match failed: pool did not pair complementary peers");
    }

    return { matchId: rahulOptIn.matchId };
  }

  async reset(actor: ActorContext): Promise<DemoSeedResult> {
    this.assertChenTeacher(actor);
    await this.assertDemoCourseAccess(actor);

    if (this.inMaintenance) {
      throw new AppError({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
        message: "Reset already in progress",
      });
    }

    this.inMaintenance = true;
    try {
      // 1. Stop speech
      this.stopSpeechTimer();
      this.speechPlaying = false;
      if (this.controlledLectureId) {
        try {
          await this.deps.speech.stop(this.controlledLectureId);
        } catch {
          // Ignore
        }
      }

      // 2. Wait for any active background jobs
      await Promise.allSettled(Array.from(this.activeBackgroundJobs));

      // 3. Disconnect demo sockets
      const demoAuthIds = new Set([
        this.chenAuthId,
        demoId("auth:hari"),
        demoId("auth:rahul"),
        demoId("auth:praj"),
        demoId("auth:vamshi"),
      ]);

      const sockets = await this.deps.io.fetchSockets();
      for (const s of sockets) {
        const socketActor = (s.data as { actor?: ActorContext })?.actor;
        if (socketActor && demoAuthIds.has(socketActor.authId)) {
          s.disconnect(true);
        }
      }

      // 4. Run reset transaction
      const result = await resetDemoDatabase(this.deps.env);

      // 5. Invalidate and refresh course heatmap snapshot
      await this.deps.heatmap.afterEvidenceApplied(
        actor,
        this.hariStudentId,
        this.vectorsConceptId,
      );

      // 6. Reset controller internal state
      this.speechCursor = 0;
      this.lastError = null;
      this.controlledLectureId = null;

      return result;
    } finally {
      this.inMaintenance = false;
    }
  }

  onPollActivated(pollId: string): void {
    if (!this.deps.config.autoRespond) {
      return;
    }

    const job = (async () => {
      try {
        const chenActor: ActorContext = {
          userId: this.chenAuthId,
          authId: this.chenAuthId,
          teacherId: this.chenTeacherId,
          name: "Prof. Sarah Chen",
          email: "sarah.chen@example.test",
          role: "teacher",
          enrolledCourses: [],
        };
        await this.submitPollResponses(chenActor, pollId);
      } catch (err: unknown) {
        this.lastError = err instanceof Error ? err.message : String(err);
        console.error("[DemoController] Auto-respond error:", err);
      }
    })();

    this.activeBackgroundJobs.add(job);
    job.finally(() => {
      this.activeBackgroundJobs.delete(job);
    });
  }

  dispose(): void {
    this.stopSpeechTimer();
    this.speechPlaying = false;
    this.activeBackgroundJobs.clear();
  }
}
