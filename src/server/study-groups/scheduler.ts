import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../contracts/common.js";
import {
  isoTimestampSchema,
  uuidSchema,
} from "../../contracts/common.js";
import type {
  StudyGroupService as StudyGroupServicePort,
  TimeInterval,
} from "../../contracts/classroom.js";
import { timeIntervalSchema } from "../../contracts/classroom.js";
import type { RealtimePublisher } from "../../contracts/realtime.js";
import { studyGroupUpdatedEventSchema } from "../../contracts/realtime.js";
import { AppError } from "../../contracts/errors.js";
import type { ZoomMeetingService } from "../zoom/index.js";
import type { MessagingRepository } from "./messaging-repository.js";
import type {
  SchedulerRepository,
  SchedulingMatch,
} from "./scheduler-repository.js";

export interface SchedulerDependencies {
  membership: Pick<MessagingRepository, "requireMatchMember">;
  repository: Pick<
    SchedulerRepository,
    "getMatch" | "getAvailability" | "compareAndSet" | "setMeetingResult"
  >;
  meetings: Pick<ZoomMeetingService, "createForCourse">;
  publisher: Pick<RealtimePublisher, "emitToStudyGroup">;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
}

interface IntervalMs {
  start: number;
  end: number;
}

const SLOT_DURATION_MS = 1_800_000; // 30 minutes in milliseconds

function mergeIntervals(raw: TimeInterval[]): IntervalMs[] {
  if (raw.length === 0) return [];
  const intervals: IntervalMs[] = raw.map((i) => ({
    start: new Date(i.startsAt).getTime(),
    end: new Date(i.endsAt).getTime(),
  }));

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: IntervalMs[] = [];
  let current = { ...intervals[0]! };

  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i]!;
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

function clipFutureIntervals(intervals: IntervalMs[], nowMs: number): IntervalMs[] {
  const future: IntervalMs[] = [];
  for (const interval of intervals) {
    if (interval.end <= nowMs) {
      continue;
    }
    const start = Math.max(interval.start, nowMs);
    if (interval.end > start) {
      future.push({ start, end: interval.end });
    }
  }
  return future;
}

function findEarliestOverlap(
  list1: IntervalMs[],
  list2: IntervalMs[],
  nowMs: number
): TimeInterval | null {
  let i = 0;
  let j = 0;

  while (i < list1.length && j < list2.length) {
    const left = list1[i]!;
    const right = list2[j]!;

    const candStart = Math.max(left.start, right.start, nowMs);
    const candEnd = Math.min(left.end, right.end);

    if (candEnd - candStart >= SLOT_DURATION_MS) {
      return {
        startsAt: new Date(candStart).toISOString(),
        endsAt: new Date(candStart + SLOT_DURATION_MS).toISOString(),
      };
    }

    if (left.end < right.end) {
      i++;
    } else if (right.end < left.end) {
      j++;
    } else {
      i++;
      j++;
    }
  }

  return null;
}

function isSameSlot(a: TimeInterval | null, b: TimeInterval | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    new Date(a.startsAt).getTime() === new Date(b.startsAt).getTime() &&
    new Date(a.endsAt).getTime() === new Date(b.endsAt).getTime()
  );
}

export class Scheduler
  implements Pick<StudyGroupServicePort, "proposeSchedule" | "acceptSchedule">
{
  private readonly membership: Pick<MessagingRepository, "requireMatchMember">;
  private readonly repository: Pick<
    SchedulerRepository,
    "getMatch" | "getAvailability" | "compareAndSet" | "setMeetingResult"
  >;
  private readonly meetings: Pick<ZoomMeetingService, "createForCourse">;
  private readonly publisher: Pick<RealtimePublisher, "emitToStudyGroup">;
  private readonly clock: Clock;
  private readonly ids: Pick<IdGenerator, "generateId">;

  constructor(dependencies: SchedulerDependencies) {
    this.membership = dependencies.membership;
    this.repository = dependencies.repository;
    this.meetings = dependencies.meetings;
    this.publisher = dependencies.publisher;
    this.clock = dependencies.clock;
    this.ids = dependencies.ids;
  }

  async proposeSchedule(
    actor: ActorContext,
    matchId: UUID
  ): Promise<{
    schedulingStatus: "proposed" | "no-overlap";
    proposedSlot?: TimeInterval;
  }> {
    const member = await this.membership.requireMatchMember(actor, matchId);
    const match = await this.repository.getMatch(member.courseId, matchId);

    if (
      !match ||
      (match.student1Id !== member.studentId && match.student2Id !== member.studentId)
    ) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    }

    if (match.status !== "active") {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Match is not active",
      });
    }

    if (match.schedulingStatus === "accepted") {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Schedule has already been accepted",
      });
    }

    const now = this.clock.now();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Non-finite current timestamp from clock",
      });
    }

    const [avail1, avail2] = await Promise.all([
      this.repository.getAvailability(match.courseId, match.student1Id),
      this.repository.getAvailability(match.courseId, match.student2Id),
    ]);

    const intervals1 = clipFutureIntervals(mergeIntervals(avail1), nowMs);
    const intervals2 = clipFutureIntervals(mergeIntervals(avail2), nowMs);

    const qualifyingSlot = findEarliestOverlap(intervals1, intervals2, nowMs);

    let desired: Pick<
      SchedulingMatch,
      "schedulingStatus" | "proposedSlot" | "student1Accepted" | "student2Accepted"
    >;

    if (qualifyingSlot !== null) {
      const isUnchangedProposal = isSameSlot(match.proposedSlot, qualifyingSlot);
      desired = {
        schedulingStatus: "proposed",
        proposedSlot: qualifyingSlot,
        student1Accepted: isUnchangedProposal ? match.student1Accepted : false,
        student2Accepted: isUnchangedProposal ? match.student2Accepted : false,
      };
    } else {
      desired = {
        schedulingStatus: "no-overlap",
        proposedSlot: null,
        student1Accepted: false,
        student2Accepted: false,
      };
    }

    const isAlreadyDesired =
      match.schedulingStatus === desired.schedulingStatus &&
      match.student1Accepted === desired.student1Accepted &&
      match.student2Accepted === desired.student2Accepted &&
      isSameSlot(match.proposedSlot, desired.proposedSlot);

    if (isAlreadyDesired) {
      if (desired.schedulingStatus === "no-overlap") {
        return { schedulingStatus: "no-overlap" };
      }
      return {
        schedulingStatus: "proposed",
        proposedSlot: desired.proposedSlot!,
      };
    }

    const updated = await this.repository.compareAndSet(match, desired);
    if (!updated) {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Schedule changed; request the current proposal again",
      });
    }

    await this.emitSchedulingEvent(updated);

    if (updated.schedulingStatus === "no-overlap") {
      return { schedulingStatus: "no-overlap" };
    }
    return {
      schedulingStatus: "proposed",
      proposedSlot: updated.proposedSlot!,
    };
  }

  async acceptSchedule(
    actor: ActorContext,
    matchId: UUID,
    slot: TimeInterval
  ): Promise<{
    bothAccepted: boolean;
    zoomMeetingId?: string;
    zoomLink?: string;
  }> {
    const member = await this.membership.requireMatchMember(actor, matchId);
    const match = await this.repository.getMatch(member.courseId, matchId);

    if (
      !match ||
      (match.student1Id !== member.studentId && match.student2Id !== member.studentId)
    ) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    }

    if (match.status !== "active") {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Match is not active",
      });
    }

    const slotParse = timeIntervalSchema.safeParse(slot);
    if (!slotParse.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid slot time interval format",
        cause: slotParse.error,
      });
    }

    const slotStartMs = new Date(slot.startsAt).getTime();
    const slotEndMs = new Date(slot.endsAt).getTime();
    if (
      !Number.isFinite(slotStartMs) ||
      !Number.isFinite(slotEndMs) ||
      slotEndMs - slotStartMs < SLOT_DURATION_MS
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Slot must have finite timestamps and duration of at least 30 minutes",
      });
    }

    if (
      !match.proposedSlot ||
      (match.schedulingStatus !== "proposed" && match.schedulingStatus !== "accepted")
    ) {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "No active proposed schedule for this match",
      });
    }

    const propStartMs = new Date(match.proposedSlot.startsAt).getTime();
    const propEndMs = new Date(match.proposedSlot.endsAt).getTime();
    if (slotStartMs !== propStartMs || slotEndMs !== propEndMs) {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Submitted slot does not match the current proposal",
      });
    }

    if (match.schedulingStatus !== "accepted") {
      const nowMs = this.clock.now().getTime();
      if (propStartMs < nowMs) {
        throw new AppError({
          code: "CONFLICT",
          statusCode: 409,
          message: "Proposed slot start time has already passed",
        });
      }
    }

    const isStudent1 = member.studentId === match.student1Id;
    const nextStudent1Accepted = isStudent1 ? true : match.student1Accepted;
    const nextStudent2Accepted = isStudent1 ? match.student2Accepted : true;
    const bothAccepted = nextStudent1Accepted && nextStudent2Accepted;
    const nextSchedulingStatus = bothAccepted ? "accepted" : "proposed";

    const alreadyAcceptedByCaller = isStudent1
      ? match.student1Accepted
      : match.student2Accepted;

    if (alreadyAcceptedByCaller) {
      if (match.schedulingStatus === "accepted") {
        if (match.meetingStatus === "created") {
          return {
            bothAccepted: true,
            zoomMeetingId: match.zoomMeetingId ?? undefined,
            zoomLink: match.zoomLink ?? undefined,
          };
        }
        if (match.meetingStatus === "unavailable") {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom meeting is unavailable for this session",
          });
        }
        if (match.meetingStatus === "pending") {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom meeting creation is incomplete",
          });
        }
      }
      return {
        bothAccepted: false,
      };
    }

    const desired = {
      schedulingStatus: nextSchedulingStatus as "proposed" | "accepted",
      proposedSlot: match.proposedSlot,
      student1Accepted: nextStudent1Accepted,
      student2Accepted: nextStudent2Accepted,
    };

    const updated = await this.repository.compareAndSet(match, desired);
    if (!updated) {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Schedule changed; request the current proposal again",
      });
    }

    if (!bothAccepted) {
      await this.emitSchedulingEvent(updated);
      return {
        bothAccepted: false,
      };
    }

    let meetingResult: { meetingId: string; joinUrl: string };
    try {
      meetingResult = await this.meetings.createForCourse(
        actor,
        updated.courseId,
        "Peer Study Session",
        updated.proposedSlot!.startsAt,
        30
      );
    } catch (meetingErr) {
      const unavailableMatch = await this.repository.setMeetingResult(updated, {
        meetingStatus: "unavailable",
      });

      if (unavailableMatch) {
        try {
          await this.emitSchedulingEvent(unavailableMatch);
        } catch {
          // If emit fails, do not mask DB commit, continue to propagate original meeting error
        }
      }

      throw meetingErr;
    }

    const persisted = await this.repository.setMeetingResult(updated, {
      meetingStatus: "created",
      zoomMeetingId: meetingResult.meetingId,
      zoomLink: meetingResult.joinUrl,
    });

    if (!persisted) {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Study group schedule state changed concurrently while persisting meeting",
      });
    }

    await this.emitSchedulingEvent(persisted);

    return {
      bothAccepted: true,
      zoomMeetingId: persisted.zoomMeetingId ?? undefined,
      zoomLink: persisted.zoomLink ?? undefined,
    };
  }
  private async emitSchedulingEvent(match: SchedulingMatch): Promise<void> {
    const eventId = this.ids.generateId();
    if (!uuidSchema.safeParse(eventId).success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to generate valid event metadata",
      });
    }

    const occurredAt = this.clock.nowISO();
    if (!isoTimestampSchema.safeParse(occurredAt).success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to generate valid event timestamp",
      });
    }

    const rawEvent: Record<string, unknown> = {
      eventId,
      occurredAt,
      matchId: match.id,
      schedulingStatus: match.schedulingStatus,
      student1Accepted: match.student1Accepted,
      student2Accepted: match.student2Accepted,
      meetingStatus: match.meetingStatus,
    };

    if (match.proposedSlot) {
      rawEvent.proposedSlot = match.proposedSlot;
    }

    if (match.zoomLink) {
      rawEvent.zoomLink = match.zoomLink;
    }

    const eventParse = studyGroupUpdatedEventSchema.safeParse(rawEvent);
    if (!eventParse.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to validate study group updated event",
        cause: eventParse.error,
      });
    }

    await this.publisher.emitToStudyGroup(
      match.id,
      "study-group:updated",
      eventParse.data
    );
  }
}
