import type {
  ActorContext,
  ISOTimestamp,
  UUID,
} from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type {
  StudyGroupCandidate,
  StudyGroupInvitationDecisionResponse,
  StudyGroupInvitationResponse,
} from "../../contracts/classroom.js";
import type { StudyGroupMatchedEvent } from "../../contracts/realtime.js";
import { confidenceToBand } from "../../contracts/mastery.js";
import { AppError } from "../../contracts/errors.js";
import type { CourseService } from "../core/index.js";
import type { PoolRepository } from "./pool-repository.js";
import type { MatchRepository } from "./match-repository.js";
import type { InvitationsRepository } from "./invitations-repository.js";
import { findComplementaryCandidates } from "./matchmaker.js";

export interface ClockPort {
  now(): Date;
  nowISO(): ISOTimestamp;
}

export interface IdGeneratorPort {
  generateId(): UUID;
}

export interface RealtimePublisherPort {
  emitToStudent(studentId: UUID, event: string, payload: unknown): Promise<void>;
}

export interface InvitationsServiceDependencies {
  courses: Pick<CourseService, "getCourse">;
  pool: Pick<PoolRepository, "getEntryByStudent" | "getActiveEntries">;
  matches: Pick<MatchRepository, "getCourseConceptIds" | "getProfiles">;
  invitations: Pick<
    InvitationsRepository,
    "createInvitation" | "respondToInvitation" | "getConceptLabels" | "getInvitationById"
  >;
  publisher: RealtimePublisherPort;
  clock: ClockPort;
  ids: IdGeneratorPort;
}

export class InvitationsService {
  private readonly courses: Pick<CourseService, "getCourse">;
  private readonly pool: Pick<
    PoolRepository,
    "getEntryByStudent" | "getActiveEntries"
  >;
  private readonly matches: Pick<
    MatchRepository,
    "getCourseConceptIds" | "getProfiles"
  >;
  private readonly invitations: Pick<
    InvitationsRepository,
    "createInvitation" | "respondToInvitation" | "getConceptLabels" | "getInvitationById"
  >;
  private readonly publisher: RealtimePublisherPort;
  private readonly clock: ClockPort;
  private readonly ids: IdGeneratorPort;

  constructor(dependencies: InvitationsServiceDependencies) {
    this.courses = dependencies.courses;
    this.pool = dependencies.pool;
    this.matches = dependencies.matches;
    this.invitations = dependencies.invitations;
    this.publisher = dependencies.publisher;
    this.clock = dependencies.clock;
    this.ids = dependencies.ids;
  }

  async getCandidates(
    actor: ActorContext,
    courseId: UUID,
  ): Promise<StudyGroupCandidate[]> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only enrolled students can discover study group candidates",
      });
    }

    const enrollment = actor.enrolledCourses.find(
      (e) => e.courseId === courseId,
    );
    if (!enrollment) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access for unverified course enrollment",
      });
    }

    const studentId = enrollment.studentId;
    await this.courses.getCourse(actor, courseId);

    const now = this.clock.now();
    const nowMs = now.getTime();

    // Check caller's pool entry
    const callerEntry = await this.pool.getEntryByStudent(studentId, courseId);
    if (
      !callerEntry ||
      callerEntry.status !== "waiting" ||
      new Date(callerEntry.expiresAt).getTime() < nowMs
    ) {
      return [];
    }

    const activeEntries = await this.pool.getActiveEntries(
      courseId,
      this.clock.nowISO(),
    );
    const candidateEntries = activeEntries.filter(
      (e) => e.studentId !== studentId && e.id !== callerEntry.id,
    );

    if (candidateEntries.length === 0) {
      return [];
    }

    const allStudentIds = [
      studentId,
      ...candidateEntries.map((e) => e.studentId),
    ];
    const allCandidateConceptIds = Array.from(
      new Set([
        ...callerEntry.conceptIds,
        ...candidateEntries.flatMap((e) => e.conceptIds),
      ]),
    );
    const profiles = await this.matches.getProfiles(
      courseId,
      allStudentIds,
      allCandidateConceptIds,
    );

    const complementary = findComplementaryCandidates(
      callerEntry,
      candidateEntries,
      profiles,
      now,
    );

    if (complementary.length === 0) {
      return [];
    }

    const allConceptIds = Array.from(
      new Set(complementary.flatMap((c) => c.conceptIds)),
    );
    const labelsMap = await this.invitations.getConceptLabels(
      courseId,
      allConceptIds,
    );

    const requesterProfile = profiles.get(studentId);

    const results: StudyGroupCandidate[] = [];

    for (const cand of complementary) {
      const candProfile = profiles.get(cand.entry.studentId);
      if (!candProfile || !requesterProfile) {
        continue;
      }

      let requesterHigher = false;
      let candidateHigher = false;

      for (const cid of cand.conceptIds) {
        const rConf = requesterProfile.confidences.get(cid);
        const cConf = candProfile.confidences.get(cid);
        if (rConf !== undefined && cConf !== undefined) {
          if (rConf > cConf) requesterHigher = true;
          if (cConf > rConf) candidateHigher = true;
        }
      }

      const fitKind: "reciprocal" | "mentor" =
        requesterHigher && candidateHigher ? "reciprocal" : "mentor";

      const requestedConcepts = [...cand.conceptIds].sort().map((cid) => ({
        conceptId: cid,
        label: labelsMap.get(cid) ?? "",
        band: confidenceToBand(candProfile.confidences.get(cid) ?? 0),
      }));

      results.push({
        studentId: cand.entry.studentId,
        requestedConcepts,
        complementaryGap: cand.gap,
        fitKind,
      });
    }

    return results;
  }

  async sendInvitation(
    actor: ActorContext,
    courseId: UUID,
    inviteeId: UUID,
    conceptIds: UUID[],
  ): Promise<StudyGroupInvitationResponse> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    if (!uuidSchema.safeParse(inviteeId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid invitee ID format",
      });
    }

    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only enrolled students can send study group invitations",
      });
    }

    const enrollment = actor.enrolledCourses.find(
      (e) => e.courseId === courseId,
    );
    if (!enrollment) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access for unverified course enrollment",
      });
    }

    const inviterId = enrollment.studentId;
    if (inviterId === inviteeId) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Cannot invite self to study group",
      });
    }

    if (
      !Array.isArray(conceptIds) ||
      conceptIds.length < 1 ||
      conceptIds.length > 3 ||
      new Set(conceptIds).size !== conceptIds.length
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invitation requires between 1 and 3 distinct concepts",
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

    await this.courses.getCourse(actor, courseId);

    const now = this.clock.now();
    const nowMs = now.getTime();

    const inviterEntry = await this.pool.getEntryByStudent(inviterId, courseId);
    if (
      !inviterEntry ||
      inviterEntry.status !== "waiting" ||
      new Date(inviterEntry.expiresAt).getTime() < nowMs
    ) {
      throw new AppError({
        code: "INVITATION_EXPIRED",
        statusCode: 409,
        message: "Inviter pool entry is no longer waiting or has expired",
      });
    }

    const inviteeEntry = await this.pool.getEntryByStudent(inviteeId, courseId);
    if (
      !inviteeEntry ||
      inviteeEntry.status !== "waiting" ||
      new Date(inviteeEntry.expiresAt).getTime() < nowMs
    ) {
      throw new AppError({
        code: "INVITATION_EXPIRED",
        statusCode: 409,
        message: "Invitee pool entry is no longer waiting or has expired",
      });
    }

    // Concepts must belong to both entries
    const inviterConceptSet = new Set(inviterEntry.conceptIds);
    const inviteeConceptSet = new Set(inviteeEntry.conceptIds);
    for (const c of conceptIds) {
      if (!inviterConceptSet.has(c) || !inviteeConceptSet.has(c)) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message:
            "Selected concepts must be requested by both students in their pool entries",
        });
      }
    }

    // Concepts must belong to course
    const validConcepts = await this.matches.getCourseConceptIds(
      courseId,
      conceptIds,
    );
    if (validConcepts.length !== conceptIds.length) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Selected concepts do not all belong to this course",
      });
    }

    // Revalidate gap >= 0.30
    const profiles = await this.matches.getProfiles(
      courseId,
      [inviterId, inviteeId],
      conceptIds,
    );
    const inviterProfile = profiles.get(inviterId);
    const inviteeProfile = profiles.get(inviteeId);

    if (!inviterProfile || !inviteeProfile) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Missing student match profile",
      });
    }

    let totalDiff = 0;
    for (const c of conceptIds) {
      const confA = inviterProfile.confidences.get(c);
      const confB = inviteeProfile.confidences.get(c);

      if (confA === undefined || confB === undefined) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message:
            "Both students must have mastery records for all selected concepts",
        });
      }

      if (
        !Number.isFinite(confA) ||
        confA < 0 ||
        confA > 1 ||
        !Number.isFinite(confB) ||
        confB < 0 ||
        confB > 1
      ) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Invalid present confidence encountered in match profile",
        });
      }

      totalDiff += Math.abs(confA - confB);
    }

    const gap = totalDiff / conceptIds.length;
    if (gap < 0.30) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message:
          "Selected concepts must meet the minimum complementary gap of 0.30",
      });
    }

    // Earlier pool expiration
    const inviterExp = new Date(inviterEntry.expiresAt).getTime();
    const inviteeExp = new Date(inviteeEntry.expiresAt).getTime();
    const expiresAt = new Date(Math.min(inviterExp, inviteeExp)).toISOString();

    return await this.invitations.createInvitation({
      courseId,
      inviterStudentId: inviterId,
      inviteeStudentId: inviteeId,
      conceptIds,
      expiresAt,
    });
  }

  async respondToInvitation(
    actor: ActorContext,
    invitationId: UUID,
    decision: "accepted" | "declined",
  ): Promise<StudyGroupInvitationDecisionResponse> {
    if (!uuidSchema.safeParse(invitationId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid invitation ID format",
      });
    }

    if (decision !== "accepted" && decision !== "declined") {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Decision must be 'accepted' or 'declined'",
      });
    }

    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only students can respond to study group invitations",
      });
    }

    const outcome = await this.invitations.respondToInvitation(
      actor.authId,
      invitationId,
      decision,
    );

    if (outcome.status === "expired") {
      throw new AppError({
        code: "INVITATION_EXPIRED",
        statusCode: 409,
        message: "Invitation has expired",
      });
    }

    // On newly committed acceptance, emit individualized study-group:matched events
    if (outcome.status === "accepted" && outcome.changed && outcome.matchId) {
      const matchId = outcome.matchId;
      try {
        const inv = await this.invitations.getInvitationById(invitationId);
        if (inv) {
          const profiles = await this.matches.getProfiles(
            inv.course_id,
            [inv.inviter_student_id, inv.invitee_student_id],
            inv.concept_ids,
          );
          const inviterName =
            profiles.get(inv.inviter_student_id)?.name ?? "Study Partner";
          const inviteeName =
            profiles.get(inv.invitee_student_id)?.name ?? "Study Partner";
          const occurredAt = this.clock.nowISO();

          const inviterEvent: StudyGroupMatchedEvent = {
            eventId: this.ids.generateId(),
            occurredAt,
            matchId,
            courseId: inv.course_id,
            conceptIds: inv.concept_ids,
            peerName: inviteeName,
          };

          const inviteeEvent: StudyGroupMatchedEvent = {
            eventId: this.ids.generateId(),
            occurredAt,
            matchId,
            courseId: inv.course_id,
            conceptIds: inv.concept_ids,
            peerName: inviterName,
          };

          const results = await Promise.allSettled([
            this.publisher.emitToStudent(
              inv.inviter_student_id,
              "study-group:matched",
              inviterEvent,
            ),
            this.publisher.emitToStudent(
              inv.invitee_student_id,
              "study-group:matched",
              inviteeEvent,
            ),
          ]);

          for (const res of results) {
            if (res.status === "rejected") {
              console.error(
                `[InvitationsService] Failed to deliver match notification for match ${matchId}:`,
                res.reason,
              );
            }
          }
        }
      } catch (err) {
        console.error(
          `[InvitationsService] Error during match notification emission for match ${matchId}:`,
          err,
        );
      }
    }

    return {
      status: outcome.status,
      matchId: outcome.matchId,
    };
  }
}
