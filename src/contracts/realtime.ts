import { z } from "zod";
import {
  type UUID,
  type ISOTimestamp,
  uuidSchema,
  isoTimestampSchema,
} from "./common.js";
import {
  confidenceSchema,
  masteryUpdatedEventSchema,
  type MasteryUpdatedEvent,
} from "./mastery.js";
import {
  type GameSummaryDTO,
  type DailyQuestDTO,
  gameSummarySchema,
  dailyQuestSchema,
} from "./game.js";

export { masteryUpdatedEventSchema, type MasteryUpdatedEvent };

export interface TranscriptChunkEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  chunkId: UUID;
  lectureId: UUID;
  text: string;
  timestampSec: number;
  speakerName?: string;
  isSimulated?: boolean;
}

export interface ConceptDetectedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  lectureId: UUID;
  conceptIds: UUID[];
}

export interface PollNewQuestionEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  pollId: UUID;
  lectureId: UUID;
  conceptId: UUID;
  question: string;
  status: "active";
  activatedAt: ISOTimestamp;
}

export interface PollClosedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  pollId: UUID;
  lectureId: UUID;
  status: "closed";
  closedAt: ISOTimestamp;
}

export interface HeatmapUpdatedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  courseId: UUID;
  totalStudents: number;
  conceptId: UUID;
  distribution: {
    gray: number;
    red: number;
    yellow: number;
    green: number;
  };
  averageConfidence: number;
}

export interface LectureEndedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  lectureId: UUID;
  endedAt: ISOTimestamp;
}

export interface LectureSummaryReadyEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  lectureId: UUID;
  summary: string;
  keyConceptsCovered: string[];
}

export interface StudyGroupMatchedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  matchId: UUID;
  courseId: UUID;
  conceptIds: UUID[];
  peerName: string;
}

export interface StudyGroupMessageEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  messageId: UUID;
  matchId: UUID;
  senderId: UUID;
  content: string;
}

export interface StudyGroupUpdatedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  matchId: UUID;
  schedulingStatus: "pending" | "proposed" | "accepted" | "no-overlap";
  proposedSlot?: {
    startsAt: ISOTimestamp;
    endsAt: ISOTimestamp;
  };
  student1Accepted: boolean;
  student2Accepted: boolean;
  zoomLink?: string;
  meetingStatus: "pending" | "created" | "unavailable";
}

export interface GameUpdatedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  studentId: UUID;
  updatedAt: ISOTimestamp;
  summary: GameSummaryDTO;
  dailyQuest: DailyQuestDTO | null;
}

export interface PartyQuestUpdatedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  matchId: UUID;
  partyQuestId: UUID;
  version: number;
  status: "active" | "completed" | "cancelled";
  completedPairs: number;
  totalPairs: number;
}

export interface LectureJoinPayload {
  lectureId: UUID;
}

export interface LectureLeavePayload {
  lectureId: UUID;
}

export interface StudyGroupJoinPayload {
  matchId: UUID;
}

export interface StudyGroupLeavePayload {
  matchId: UUID;
}

export interface SocketAckResponse {
  success: boolean;
  error?: string;
}

export interface RealtimePublisher {
  emitToLecture(lectureId: UUID, event: string, payload: unknown): Promise<void>;
  emitToTeacher(lectureId: UUID, event: string, payload: unknown): Promise<void>;
  emitToStudent(studentId: UUID, event: string, payload: unknown): Promise<void>;
  emitToStudyGroup(matchId: UUID, event: string, payload: unknown): Promise<void>;
}

export interface ServerToClientEvents {
  "transcript:chunk": (payload: TranscriptChunkEvent) => void;
  "lecture:concept-detected": (payload: ConceptDetectedEvent) => void;
  "poll:new-question": (payload: PollNewQuestionEvent) => void;
  "poll:closed": (payload: PollClosedEvent) => void;
  "mastery:updated": (payload: MasteryUpdatedEvent) => void;
  "heatmap:updated": (payload: HeatmapUpdatedEvent) => void;
  "lecture:ended": (payload: LectureEndedEvent) => void;
  "lecture:summary-ready": (payload: LectureSummaryReadyEvent) => void;
  "study-group:matched": (payload: StudyGroupMatchedEvent) => void;
  "study-group:message": (payload: StudyGroupMessageEvent) => void;
  "study-group:updated": (payload: StudyGroupUpdatedEvent) => void;
  "game:updated": (payload: GameUpdatedEvent) => void;
  "party:quest-updated": (payload: PartyQuestUpdatedEvent) => void;
}

export interface ClientToServerEvents {
  "lecture:join": (
    payload: LectureJoinPayload,
    ack: (res: SocketAckResponse) => void
  ) => void;
  "lecture:leave": (
    payload: LectureLeavePayload,
    ack: (res: SocketAckResponse) => void
  ) => void;
  "study-group:join": (
    payload: StudyGroupJoinPayload,
    ack: (res: SocketAckResponse) => void
  ) => void;
  "study-group:leave": (
    payload: StudyGroupLeavePayload,
    ack: (res: SocketAckResponse) => void
  ) => void;
}

export const transcriptChunkEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  chunkId: uuidSchema,
  lectureId: uuidSchema,
  text: z.string().min(1),
  timestampSec: z.number().nonnegative(),
  speakerName: z.string().optional(),
  isSimulated: z.boolean().optional(),
});

export const conceptDetectedEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  lectureId: uuidSchema,
  conceptIds: z.array(uuidSchema),
});

export const pollNewQuestionEventSchema = z
  .object({
    eventId: uuidSchema,
    occurredAt: isoTimestampSchema,
    pollId: uuidSchema,
    lectureId: uuidSchema,
    conceptId: uuidSchema,
    question: z.string().min(1),
    status: z.literal("active"),
    activatedAt: isoTimestampSchema,
  })
  .strict()
  .refine(
    (data: Record<string, unknown>) =>
      !("expectedAnswer" in data) && !("rubric" in data),
    {
      message:
        "SC-08 Violation: Poll broadcast events must never leak expectedAnswer or rubric",
    }
  );

export const pollClosedEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  pollId: uuidSchema,
  lectureId: uuidSchema,
  status: z.literal("closed"),
  closedAt: isoTimestampSchema,
});

export const heatmapUpdatedEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  courseId: uuidSchema,
  totalStudents: z.number().int().nonnegative(),
  conceptId: uuidSchema,
  distribution: z.object({
    gray: z.number().int().nonnegative(),
    red: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    green: z.number().int().nonnegative(),
  }),
  averageConfidence: confidenceSchema,
});

export const lectureEndedEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  lectureId: uuidSchema,
  endedAt: isoTimestampSchema,
});

export const lectureSummaryReadyEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  lectureId: uuidSchema,
  summary: z.string().min(1),
  keyConceptsCovered: z.array(z.string().min(1)),
});

export const studyGroupMatchedEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  matchId: uuidSchema,
  courseId: uuidSchema,
  conceptIds: z.array(uuidSchema),
  peerName: z.string().min(1),
});

export const studyGroupMessageEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  messageId: uuidSchema,
  matchId: uuidSchema,
  senderId: uuidSchema,
  content: z.string().min(1),
});

export const studyGroupUpdatedEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  matchId: uuidSchema,
  schedulingStatus: z.enum(["pending", "proposed", "accepted", "no-overlap"]),
  proposedSlot: z
    .object({
      startsAt: isoTimestampSchema,
      endsAt: isoTimestampSchema,
    })
    .optional(),
  student1Accepted: z.boolean(),
  student2Accepted: z.boolean(),
  zoomLink: z.url().optional(),
  meetingStatus: z.enum(["pending", "created", "unavailable"]),
});

export const lectureJoinPayloadSchema = z.object({
  lectureId: uuidSchema,
});

export const lectureLeavePayloadSchema = z.object({
  lectureId: uuidSchema,
});

export const studyGroupJoinPayloadSchema = z.object({
  matchId: uuidSchema,
});

export const studyGroupLeavePayloadSchema = z.object({
  matchId: uuidSchema,
});

export const socketAckResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export const gameUpdatedEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  studentId: uuidSchema,
  updatedAt: isoTimestampSchema,
  summary: gameSummarySchema,
  dailyQuest: dailyQuestSchema.nullable(),
});

export const partyQuestUpdatedEventSchema = z
  .object({
    eventId: uuidSchema,
    occurredAt: isoTimestampSchema,
    matchId: uuidSchema,
    partyQuestId: uuidSchema,
    version: z.number().int().positive(),
    status: z.enum(["active", "completed", "cancelled"]),
    completedPairs: z.number().int().min(0),
    totalPairs: z.union([z.literal(2), z.literal(4), z.literal(6)]),
  })
  .refine((data) => data.completedPairs <= data.totalPairs, {
    message: "completedPairs must not exceed totalPairs",
    path: ["completedPairs"],
  });
