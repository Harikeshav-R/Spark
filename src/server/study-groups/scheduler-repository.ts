import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TimeInterval } from "../../contracts/classroom.js";
import type { UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import { mapPostgrestError } from "../platform/index.js";

export interface SchedulingMatch {
  id: UUID;
  courseId: UUID;
  student1Id: UUID;
  student2Id: UUID;
  status: "active" | "completed" | "cancelled";
  schedulingStatus: "pending" | "proposed" | "accepted" | "no-overlap";
  proposedSlot: TimeInterval | null;
  student1Accepted: boolean;
  student2Accepted: boolean;
  meetingStatus: "pending" | "created" | "unavailable";
  zoomMeetingId: string | null;
  zoomLink: string | null;
}

const matchSnapshotRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
  student1_id: uuidSchema,
  student2_id: uuidSchema,
  status: z.enum(["active", "completed", "cancelled"]),
  scheduling_status: z.enum(["pending", "proposed", "accepted", "no-overlap"]),
  proposed_start: z.union([z.string(), z.date()]).nullable(),
  proposed_end: z.union([z.string(), z.date()]).nullable(),
  student1_accepted: z.boolean(),
  student2_accepted: z.boolean(),
  meeting_status: z.enum(["pending", "created", "unavailable"]),
  zoom_meeting_id: z.string().nullable().optional(),
  zoom_link: z.string().nullable().optional(),
});

const availabilityRowSchema = z.object({
  id: uuidSchema,
  starts_at: z.union([z.string(), z.date()]),
  ends_at: z.union([z.string(), z.date()]),
});

const MATCH_SELECT_COLUMNS =
  "id, course_id, student1_id, student2_id, status, scheduling_status, proposed_start, proposed_end, student1_accepted, student2_accepted, meeting_status, zoom_meeting_id, zoom_link";

function parseFiniteUtcTimestamp(val: string | Date, fieldName: string): string {
  const d = new Date(val);
  const time = d.getTime();
  if (!Number.isFinite(time)) {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: `Invalid or non-finite timestamp in ${fieldName}`,
    });
  }
  return d.toISOString();
}

function mapRowToSchedulingMatch(rawRow: unknown): SchedulingMatch {
  const parseResult = matchSnapshotRowSchema.safeParse(rawRow);
  if (!parseResult.success) {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Failed to parse study group match snapshot record",
      cause: parseResult.error,
    });
  }

  const row = parseResult.data;

  const startNull = row.proposed_start === null;
  const endNull = row.proposed_end === null;
  if (startNull !== endNull) {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Inconsistent proposed slot timestamps: one is null while the other is present",
    });
  }

  let proposedSlot: TimeInterval | null = null;
  if (row.proposed_start !== null && row.proposed_end !== null) {
    const startsAt = parseFiniteUtcTimestamp(row.proposed_start, "proposed_start");
    const endsAt = parseFiniteUtcTimestamp(row.proposed_end, "proposed_end");
    const duration = new Date(endsAt).getTime() - new Date(startsAt).getTime();
    if (duration < 1_800_000) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: `Proposed slot duration must be at least 30 minutes, got ${duration}ms`,
      });
    }
    proposedSlot = { startsAt, endsAt };
  }

  if (
    (row.scheduling_status === "proposed" || row.scheduling_status === "accepted") &&
    proposedSlot === null
  ) {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: `Scheduling status is '${row.scheduling_status}' but proposed slot is null`,
    });
  }

  if (row.scheduling_status === "accepted" && (!row.student1_accepted || !row.student2_accepted)) {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Scheduling status is 'accepted' but both students have not accepted",
    });
  }

  if (row.scheduling_status === "no-overlap" && proposedSlot !== null) {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Scheduling status is 'no-overlap' but proposed slot is present",
    });
  }

  return {
    id: row.id,
    courseId: row.course_id,
    student1Id: row.student1_id,
    student2Id: row.student2_id,
    status: row.status,
    schedulingStatus: row.scheduling_status,
    proposedSlot,
    student1Accepted: row.student1_accepted,
    student2Accepted: row.student2_accepted,
    meetingStatus: row.meeting_status,
    zoomMeetingId: row.zoom_meeting_id ?? null,
    zoomLink: row.zoom_link ?? null,
  };
}

export type SchedulerDatabaseClientPort = Pick<SupabaseClient, "from"> & {
  rpc?: (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>;
};

export class SchedulerRepository {
  private readonly client: SchedulerDatabaseClientPort;

  constructor(client: SchedulerDatabaseClientPort | SupabaseClient) {
    this.client = client as SchedulerDatabaseClientPort;
  }

  async getMatch(courseId: UUID, matchId: UUID): Promise<SchedulingMatch | null> {
    let result;
    try {
      result = await this.client
        .from("study_group_matches")
        .select(MATCH_SELECT_COLUMNS)
        .eq("id", matchId)
        .eq("course_id", courseId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query study group match",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(result.error, "Database error querying study group match");
    }

    if (!result.data) {
      return null;
    }

    return mapRowToSchedulingMatch(result.data);
  }

  async getAvailability(courseId: UUID, studentId: UUID): Promise<TimeInterval[]> {
    const pageSize = 1000;
    let offset = 0;
    const intervals: TimeInterval[] = [];

    while (true) {
      let result;
      try {
        result = await this.client
          .from("student_availability")
          .select("id, starts_at, ends_at")
          .eq("course_id", courseId)
          .eq("student_id", studentId)
          .order("starts_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
      } catch (err) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Failed to query student availability",
          cause: err,
        });
      }

      if (result.error) {
        throw mapPostgrestError(result.error, "Database error querying student availability");
      }

      const rows = result.data ?? [];
      const parsedRows = z.array(availabilityRowSchema).safeParse(rows);
      if (!parsedRows.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to parse student availability records",
          cause: parsedRows.error,
        });
      }

      for (const row of parsedRows.data) {
        const startsAt = parseFiniteUtcTimestamp(row.starts_at, "availability.starts_at");
        const endsAt = parseFiniteUtcTimestamp(row.ends_at, "availability.ends_at");
        const duration = new Date(endsAt).getTime() - new Date(startsAt).getTime();
        if (duration < 1_800_000) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: `Student availability duration must be at least 30 minutes, got ${duration}ms`,
          });
        }
        intervals.push({ startsAt, endsAt });
      }

      if (rows.length < pageSize) {
        break;
      }
      offset += pageSize;
    }

    return intervals;
  }

  async replaceAvailability(
    actorAuthId: UUID,
    studentId: UUID,
    courseId: UUID,
    intervals: Array<{ start: string; end: string }>
  ): Promise<void> {
    if (!this.client.rpc) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Database client does not support RPC",
      });
    }
    try {
      const result = await this.client.rpc("replace_student_availability", {
        p_actor_auth_id: actorAuthId,
        p_student_id: studentId,
        p_course_id: courseId,
        p_intervals: intervals,
      });

      if (result.error) {
        throw mapPostgrestError(
          result.error,
          "Database error updating student availability"
        );
      }
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to update student availability",
        cause: err,
      });
    }
  }

  async compareAndSet(
    previous: SchedulingMatch,
    next: Pick<
      SchedulingMatch,
      "schedulingStatus" | "proposedSlot" | "student1Accepted" | "student2Accepted"
    >
  ): Promise<SchedulingMatch | null> {
    const updatePayload = {
      scheduling_status: next.schedulingStatus,
      proposed_start: next.proposedSlot ? next.proposedSlot.startsAt : null,
      proposed_end: next.proposedSlot ? next.proposedSlot.endsAt : null,
      student1_accepted: next.student1Accepted,
      student2_accepted: next.student2Accepted,
    };

    let query = this.client
      .from("study_group_matches")
      .update(updatePayload)
      .eq("id", previous.id)
      .eq("course_id", previous.courseId)
      .eq("student1_id", previous.student1Id)
      .eq("student2_id", previous.student2Id)
      .eq("status", "active")
      .eq("scheduling_status", previous.schedulingStatus)
      .eq("student1_accepted", previous.student1Accepted)
      .eq("student2_accepted", previous.student2Accepted);

    if (previous.proposedSlot === null) {
      query = query.is("proposed_start", null).is("proposed_end", null);
    } else {
      query = query
        .eq("proposed_start", previous.proposedSlot.startsAt)
        .eq("proposed_end", previous.proposedSlot.endsAt);
    }

    let result;
    try {
      result = await query.select(MATCH_SELECT_COLUMNS).maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to update study group match",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(result.error, "Database error updating study group match");
    }

    if (!result.data) {
      return null;
    }

    return mapRowToSchedulingMatch(result.data);
  }

  async setMeetingResult(
    previous: SchedulingMatch,
    result:
      | { meetingStatus: "created"; zoomMeetingId: string; zoomLink: string }
      | { meetingStatus: "unavailable" }
  ): Promise<SchedulingMatch | null> {
    if (result.meetingStatus === "created") {
      if (!result.zoomMeetingId?.trim() || !result.zoomLink?.trim()) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Created meeting result must include non-empty zoomMeetingId and zoomLink",
        });
      }
    }

    const updatePayload =
      result.meetingStatus === "created"
        ? {
            meeting_status: "created",
            zoom_meeting_id: result.zoomMeetingId,
            zoom_link: result.zoomLink,
          }
        : {
            meeting_status: "unavailable",
            zoom_meeting_id: null,
            zoom_link: null,
          };

    let query = this.client
      .from("study_group_matches")
      .update(updatePayload)
      .eq("id", previous.id)
      .eq("course_id", previous.courseId)
      .eq("student1_id", previous.student1Id)
      .eq("student2_id", previous.student2Id)
      .eq("status", "active")
      .eq("scheduling_status", "accepted")
      .eq("student1_accepted", true)
      .eq("student2_accepted", true)
      .eq("meeting_status", previous.meetingStatus);

    if (previous.proposedSlot === null) {
      query = query.is("proposed_start", null).is("proposed_end", null);
    } else {
      query = query
        .eq("proposed_start", previous.proposedSlot.startsAt)
        .eq("proposed_end", previous.proposedSlot.endsAt);
    }

    if (previous.zoomMeetingId === null) {
      query = query.is("zoom_meeting_id", null);
    } else {
      query = query.eq("zoom_meeting_id", previous.zoomMeetingId);
    }

    if (previous.zoomLink === null) {
      query = query.is("zoom_link", null);
    } else {
      query = query.eq("zoom_link", previous.zoomLink);
    }

    let res;
    try {
      res = await query.select(MATCH_SELECT_COLUMNS).maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to update study group match meeting status",
        cause: err,
      });
    }

    if (res.error) {
      throw mapPostgrestError(res.error, "Database error updating study group match meeting status");
    }

    if (!res.data) {
      return null;
    }

    const match = mapRowToSchedulingMatch(res.data);
    if (result.meetingStatus === "created" && (!match.zoomMeetingId || !match.zoomLink)) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Persisted match is inconsistent with created meeting result",
      });
    }

    return match;
  }
}
