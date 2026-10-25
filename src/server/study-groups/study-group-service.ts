import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type { CourseService } from "../../contracts/course.js";
import { AppError } from "../../contracts/errors.js";
import type {
  StudyGroupOptInResponse,
  StudyGroupService as StudyGroupServicePort,
} from "../../contracts/classroom.js";
import type {
  RealtimePublisher,
  StudyGroupMatchedEvent,
} from "../../contracts/realtime.js";
import type { MatchRepository } from "./match-repository.js";
import {
  findComplementaryCandidates,
  type ComplementaryCandidate,
} from "./matchmaker.js";
import type { PoolRepository } from "./pool-repository.js";

export interface StudyGroupServiceDependencies {
  courses: Pick<CourseService, "getCourse">;
  pool: Pick<
    PoolRepository,
    | "insertPoolEntry"
    | "getActiveEntries"
    | "getEntryByStudent"
    | "cancelWaitingEntry"
    | "cleanupExpiredForCourse"
    | "reactivateInactiveEntry"
  >;
  matches: Pick<
    MatchRepository,
    "getCourseConceptIds" | "getProfiles" | "claimMatch"
  >;
  publisher: Pick<RealtimePublisher, "emitToStudent">;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
}

export class StudyGroupService
  implements Pick<StudyGroupServicePort, "optIntoPool" | "optOutOfPool">
{
  private readonly courses: Pick<CourseService, "getCourse">;
  private readonly pool: Pick<
    PoolRepository,
    | "insertPoolEntry"
    | "getActiveEntries"
    | "getEntryByStudent"
    | "cancelWaitingEntry"
    | "cleanupExpiredForCourse"
    | "reactivateInactiveEntry"
  >;
  private readonly matches: Pick<
    MatchRepository,
    "getCourseConceptIds" | "getProfiles" | "claimMatch"
  >;
  private readonly publisher: Pick<RealtimePublisher, "emitToStudent">;
  private readonly clock: Clock;
  private readonly ids: Pick<IdGenerator, "generateId">;

  constructor(deps: StudyGroupServiceDependencies) {
    this.courses = deps.courses;
    this.pool = deps.pool;
    this.matches = deps.matches;
    this.publisher = deps.publisher;
    this.clock = deps.clock;
    this.ids = deps.ids;
  }

  async optIntoPool(
    actor: ActorContext,
    courseId: UUID,
    conceptIds: UUID[],
  ): Promise<StudyGroupOptInResponse> {
    // 1. Validate inputs and role/enrollment
    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only enrolled students can opt into the study group pool",
      });
    }

    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    const enrollment = actor.enrolledCourses?.find(
      (e) => e.courseId === courseId,
    );
    if (!enrollment || !enrollment.studentId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Actor is not enrolled in the specified course",
      });
    }
    const studentId = enrollment.studentId;

    if (
      !Array.isArray(conceptIds) ||
      conceptIds.length < 1 ||
      conceptIds.length > 3
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Opt-in requires between 1 and 3 concepts",
      });
    }

    for (const c of conceptIds) {
      if (!uuidSchema.safeParse(c).success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid concept ID format",
        });
      }
    }

    const uniqueConcepts = new Set(conceptIds);
    if (uniqueConcepts.size !== conceptIds.length) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Concepts must be distinct",
      });
    }

    // 2. Revalidate persisted enrollment via courses service
    await this.courses.getCourse(actor, courseId);

    // 3. Verify every concept belongs to this course
    const courseConceptIds = await this.matches.getCourseConceptIds(
      courseId,
      conceptIds,
    );
    if (courseConceptIds.length !== conceptIds.length) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "One or more requested concepts do not belong to this course",
      });
    }

    // 4. Time snapshot, course-scoped cleanup, reactivation or insert
    const now = this.clock.now();
    const nowISO = now.toISOString();
    const expiresAtISO = new Date(now.getTime() + 300_000).toISOString();

    await this.pool.cleanupExpiredForCourse(courseId, nowISO);

    let poolEntry = await this.pool.reactivateInactiveEntry(
      studentId,
      courseId,
      conceptIds,
      nowISO,
      expiresAtISO,
    );

    if (!poolEntry) {
      poolEntry = await this.pool.insertPoolEntry({
        id: this.ids.generateId(),
        studentId,
        courseId,
        conceptIds,
        createdAt: nowISO,
        expiresAt: expiresAtISO,
      });
    }

    // 5. Query active entries, bulk-load persisted profiles, find complementary candidates
    const activeEntries = await this.pool.getActiveEntries(courseId, nowISO);
    const candidateEntries = activeEntries.filter(
      (e) => e.studentId !== studentId && e.id !== poolEntry.id,
    );

    const allStudentIds = [
      studentId,
      ...candidateEntries.map((e) => e.studentId),
    ];
    const allConceptIds = Array.from(
      new Set([...conceptIds, ...candidateEntries.flatMap((e) => e.conceptIds)]),
    );

    const profiles = await this.matches.getProfiles(
      courseId,
      allStudentIds,
      allConceptIds,
    );
    const actorProfile = profiles.get(studentId);
    if (!actorProfile) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Actor profile not found in course",
      });
    }

    const eligibleCandidates = findComplementaryCandidates(
      poolEntry,
      candidateEntries,
      profiles,
      now,
    );

    // 6. Walk candidates and attempt claimMatch
    let winningCandidate: ComplementaryCandidate | null = null;
    let winningMatchId: UUID | null = null;

    for (const candidate of eligibleCandidates) {
      const currentNow = this.clock.now();
      const currentNowMs = currentNow.getTime();

      const requesterExpiryMs = new Date(poolEntry.expiresAt).getTime();
      const candidateExpiryMs = new Date(candidate.entry.expiresAt).getTime();

      if (requesterExpiryMs < currentNowMs) {
        throw new AppError({
          code: "CONFLICT",
          statusCode: 409,
          message: "Pool entry has expired",
        });
      }

      if (candidateExpiryMs < currentNowMs) {
        continue;
      }

      const matchId = await this.matches.claimMatch(
        courseId,
        studentId,
        candidate.entry.studentId,
        candidate.conceptIds,
      );

      if (matchId) {
        winningCandidate = candidate;
        winningMatchId = matchId;
        break;
      }

      // Null returned means contention: inspect requester row
      const currentRequesterEntry = await this.pool.getEntryByStudent(
        studentId,
        courseId,
      );
      if (
        !currentRequesterEntry ||
        currentRequesterEntry.status !== "waiting" ||
        new Date(currentRequesterEntry.expiresAt).getTime() < currentNowMs
      ) {
        throw new AppError({
          code: "CONFLICT",
          statusCode: 409,
          message: "Pool entry is no longer waiting or has expired",
        });
      }
    }

    // 7. On winning claim, emit individualized socket events and return matched
    if (winningCandidate && winningMatchId) {
      const candidateStudentId = winningCandidate.entry.studentId;
      const candidateProfile = profiles.get(candidateStudentId);
      const candidateName = candidateProfile?.name ?? "Study Partner";
      const actorName = actorProfile.name;

      const occurredAt = this.clock.nowISO();

      const requesterEvent: StudyGroupMatchedEvent = {
        eventId: this.ids.generateId(),
        occurredAt,
        matchId: winningMatchId,
        courseId,
        conceptIds: winningCandidate.conceptIds,
        peerName: candidateName,
      };

      const candidateEvent: StudyGroupMatchedEvent = {
        eventId: this.ids.generateId(),
        occurredAt,
        matchId: winningMatchId,
        courseId,
        conceptIds: winningCandidate.conceptIds,
        peerName: actorName,
      };

      const deliveryResults = await Promise.allSettled([
        this.publisher.emitToStudent(
          studentId,
          "study-group:matched",
          requesterEvent,
        ),
        this.publisher.emitToStudent(
          candidateStudentId,
          "study-group:matched",
          candidateEvent,
        ),
      ]);

      for (let i = 0; i < deliveryResults.length; i++) {
        const res = deliveryResults[i];
        if (res.status === "rejected") {
          const targetStudent = i === 0 ? studentId : candidateStudentId;
          console.error(
            `[StudyGroupService] Failed to deliver match notification to student ${targetStudent} for match ${winningMatchId}:`,
            res.reason,
          );
        }
      }

      return {
        status: "matched",
        matchId: winningMatchId,
        expiresAt: poolEntry.expiresAt,
      };
    }

    // 8. No winning candidate: re-read requester row and return waiting or conflict
    const latestEntry = await this.pool.getEntryByStudent(studentId, courseId);
    const currentNowMs = this.clock.now().getTime();
    if (
      !latestEntry ||
      latestEntry.status !== "waiting" ||
      new Date(latestEntry.expiresAt).getTime() < currentNowMs
    ) {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Pool entry is no longer waiting or has expired",
      });
    }

    return {
      status: "waiting",
      expiresAt: latestEntry.expiresAt,
    };
  }

  async optOutOfPool(actor: ActorContext, courseId: UUID): Promise<void> {
    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only enrolled students can opt out of the study group pool",
      });
    }

    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    const enrollment = actor.enrolledCourses?.find(
      (e) => e.courseId === courseId,
    );
    if (!enrollment || !enrollment.studentId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Actor is not enrolled in the specified course",
      });
    }
    const studentId = enrollment.studentId;

    await this.courses.getCourse(actor, courseId);
    await this.pool.cancelWaitingEntry(studentId, courseId);
  }
}
