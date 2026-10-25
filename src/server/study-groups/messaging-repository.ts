import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActorContext, ISOTimestamp, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type { StudyGroupMessage } from "../../contracts/classroom.js";
import { studyGroupMessageSchema } from "../../contracts/classroom.js";
import { AppError } from "../../contracts/errors.js";
import { mapPostgrestError } from "../platform/index.js";

const studentRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
});

const matchRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
  student1_id: uuidSchema,
  student2_id: uuidSchema,
});

const messageRowSchema = z.object({
  id: uuidSchema,
  sender_id: uuidSchema,
  content: z.string(),
  created_at: z.union([z.string(), z.date()]),
});

export class MessagingRepository {
  private readonly client: Pick<SupabaseClient, "from">;

  constructor(client: Pick<SupabaseClient, "from">) {
    this.client = client;
  }

  async requireMatchMember(
    actor: ActorContext,
    matchId: UUID,
  ): Promise<{ courseId: UUID; studentId: UUID }> {
    const parsedMatchId = uuidSchema.safeParse(matchId);
    if (!parsedMatchId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid match ID format",
        cause: parsedMatchId.error,
      });
    }

    if (actor.role !== "student" || actor.enrolledCourses.length === 0) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    }

    const studentIds = actor.enrolledCourses.map((e) => e.studentId);
    const courseIds = Array.from(new Set(actor.enrolledCourses.map((e) => e.courseId)));

    let studentResult;
    try {
      studentResult = await this.client
        .from("students")
        .select("id, course_id")
        .eq("auth_id", actor.authId)
        .in("id", studentIds)
        .in("course_id", courseIds);
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to verify student enrollment",
        cause: err,
      });
    }

    if (studentResult.error) {
      throw mapPostgrestError(
        studentResult.error,
        "Database error verifying student enrollment",
      );
    }

    const studentRowsParse = z.array(studentRowSchema).safeParse(studentResult.data);
    if (!studentRowsParse.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse student enrollment records",
        cause: studentRowsParse.error,
      });
    }

    const validEnrollments = studentRowsParse.data.filter((row) =>
      actor.enrolledCourses.some(
        (e) => e.studentId === row.id && e.courseId === row.course_id,
      ),
    );

    if (validEnrollments.length === 0) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    }

    const verifiedCourseIds = Array.from(
      new Set(validEnrollments.map((e) => e.course_id)),
    );

    let matchResult;
    try {
      matchResult = await this.client
        .from("study_group_matches")
        .select("id, course_id, student1_id, student2_id")
        .eq("id", matchId)
        .in("course_id", verifiedCourseIds)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query study group match",
        cause: err,
      });
    }

    if (matchResult.error) {
      throw mapPostgrestError(
        matchResult.error,
        "Database error querying study group match",
      );
    }

    if (!matchResult.data) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    }

    const matchParse = matchRowSchema.safeParse(matchResult.data);
    if (!matchParse.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse study group match record",
        cause: matchParse.error,
      });
    }

    const match = matchParse.data;
    const memberEnrollment = validEnrollments.find(
      (e) =>
        e.course_id === match.course_id &&
        (e.id === match.student1_id || e.id === match.student2_id),
    );

    if (!memberEnrollment) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    }

    return {
      courseId: memberEnrollment.course_id,
      studentId: memberEnrollment.id,
    };
  }

  async insertMessage(input: {
    id: UUID;
    matchId: UUID;
    senderId: UUID;
    content: string;
    createdAt: ISOTimestamp;
  }): Promise<StudyGroupMessage> {
    let insertResult;
    try {
      insertResult = await this.client
        .from("study_group_messages")
        .insert({
          id: input.id,
          match_id: input.matchId,
          sender_id: input.senderId,
          content: input.content,
          created_at: input.createdAt,
        })
        .select("id, sender_id, content, created_at")
        .single();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to insert study group message",
        cause: err,
      });
    }

    if (insertResult.error) {
      throw mapPostgrestError(
        insertResult.error,
        "Database error inserting study group message",
      );
    }

    const rowParse = messageRowSchema.safeParse(insertResult.data);
    if (!rowParse.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse inserted message record",
        cause: rowParse.error,
      });
    }

    const rawDate = new Date(rowParse.data.created_at);
    if (Number.isNaN(rawDate.getTime())) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Invalid timestamp in inserted message record",
      });
    }

    const dto = {
      id: rowParse.data.id,
      senderId: rowParse.data.sender_id,
      content: rowParse.data.content,
      createdAt: rawDate.toISOString(),
    };

    const parsedDTO = studyGroupMessageSchema.safeParse(dto);
    if (!parsedDTO.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to validate persisted message record",
        cause: parsedDTO.error,
      });
    }

    return parsedDTO.data;
  }

  async getMessagesForMatch(matchId: UUID): Promise<StudyGroupMessage[]> {
    const parsedMatchId = uuidSchema.safeParse(matchId);
    if (!parsedMatchId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid match ID format",
        cause: parsedMatchId.error,
      });
    }

    const PAGE_SIZE = 1000;
    let offset = 0;
    const messages: StudyGroupMessage[] = [];

    while (true) {
      let pageResult;
      try {
        pageResult = await this.client
          .from("study_group_messages")
          .select("id, sender_id, content, created_at")
          .eq("match_id", matchId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
      } catch (err) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Failed to fetch study group messages",
          cause: err,
        });
      }

      if (pageResult.error) {
        throw mapPostgrestError(
          pageResult.error,
          "Database error fetching study group messages",
        );
      }

      const rows = pageResult.data ?? [];
      for (const row of rows) {
        const rowParse = messageRowSchema.safeParse(row);
        if (!rowParse.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Failed to parse study group message row",
            cause: rowParse.error,
          });
        }

        const rawDate = new Date(rowParse.data.created_at);
        if (Number.isNaN(rawDate.getTime())) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Invalid timestamp in study group message",
          });
        }

        const dto = {
          id: rowParse.data.id,
          senderId: rowParse.data.sender_id,
          content: rowParse.data.content,
          createdAt: rawDate.toISOString(),
        };

        const dtoParse = studyGroupMessageSchema.safeParse(dto);
        if (!dtoParse.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Failed to validate study group message DTO",
            cause: dtoParse.error,
          });
        }

        messages.push(dtoParse.data);
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }
      offset += PAGE_SIZE;
    }

    return messages;
  }
}
