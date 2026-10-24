import { z } from "zod";
import {
  type UUID,
  type ISOTimestamp,
  type ActorContext,
  type MasteryBand,
  uuidSchema,
  isoTimestampSchema,
  masteryBandSchema,
} from "./common.js";
import { confidenceSchema } from "./mastery.js";

export type LectureStatus = "live" | "completed";

export interface LectureSession {
  id: UUID;
  courseId: UUID;
  title: string;
  status: LectureStatus;
  startedAt: ISOTimestamp;
  endedAt?: ISOTimestamp;
}

export interface TranscriptChunk {
  id: UUID;
  lectureId: UUID;
  text: string;
  timestampSec: number;
  speakerName?: string;
  detectedConceptIds: UUID[];
  createdAt: ISOTimestamp;
}

export type PollStatus = "draft" | "active" | "closed";

export interface PollQuestion {
  id: UUID;
  lectureId: UUID;
  conceptId: UUID;
  question: string;
  expectedAnswer: string;
  status: PollStatus;
  generatedAt: ISOTimestamp;
  activatedAt?: ISOTimestamp;
  closedAt?: ISOTimestamp;
}

export type PollResponseOutcome = "correct" | "partial" | "wrong";

export interface PollResponseEvaluation {
  outcome: PollResponseOutcome;
  feedback: string;
}

export interface PollResponseResult {
  responseId: UUID;
  status: "evaluated";
  evaluation: PollResponseEvaluation;
  newConfidence: number;
  newBand: MasteryBand;
}

export interface LectureSnapshot {
  lecture: LectureSession;
  activePoll: PollQuestion | null;
  recentChunks: TranscriptChunk[];
  activeConceptIds: UUID[];
}

export interface TranscriptIngestResponse {
  chunkId: UUID;
  detectedConceptIds: UUID[];
}

export type StudyGroupOptInStatus = "waiting" | "matched";

export interface StudyGroupOptInResponse {
  status: StudyGroupOptInStatus;
  matchId?: UUID;
  expiresAt: ISOTimestamp;
}

export interface TimeInterval {
  startsAt: ISOTimestamp;
  endsAt: ISOTimestamp;
}

export interface StudyGroupMessage {
  id: UUID;
  senderId: UUID;
  content: string;
  createdAt: ISOTimestamp;
}

export interface ClassroomService {
  startLecture(actor: ActorContext, courseId: UUID, title: string): Promise<LectureSession>;
  endLecture(actor: ActorContext, lectureId: UUID): Promise<LectureSession>;
  getLectureSnapshot(actor: ActorContext, lectureId: UUID): Promise<LectureSnapshot>;
  ingestTranscriptChunk(
    actor: ActorContext,
    lectureId: UUID,
    text: string,
    timestampSec: number,
    speakerName?: string
  ): Promise<TranscriptChunk>;
  generatePoll(actor: ActorContext, lectureId: UUID, conceptId?: UUID): Promise<PollQuestion>;
  activatePoll(actor: ActorContext, pollId: UUID): Promise<PollQuestion>;
  respondToPoll(
    actor: ActorContext,
    pollId: UUID,
    studentId: UUID,
    answer: string
  ): Promise<PollResponseResult>;
  closePoll(actor: ActorContext, pollId: UUID): Promise<PollQuestion>;
}

export interface StudyGroupService {
  optIntoPool(
    actor: ActorContext,
    courseId: UUID,
    conceptIds: UUID[]
  ): Promise<StudyGroupOptInResponse>;
  optOutOfPool(actor: ActorContext, courseId: UUID): Promise<void>;
  registerAvailability(
    actor: ActorContext,
    courseId: UUID,
    intervals: TimeInterval[]
  ): Promise<void>;
  getMatchMessages(
    actor: ActorContext,
    matchId: UUID
  ): Promise<StudyGroupMessage[]>;
  sendMessage(
    actor: ActorContext,
    matchId: UUID,
    content: string
  ): Promise<StudyGroupMessage>;
  proposeSchedule(
    actor: ActorContext,
    matchId: UUID
  ): Promise<{
    schedulingStatus: "proposed" | "no-overlap";
    proposedSlot?: TimeInterval;
  }>;
  acceptSchedule(
    actor: ActorContext,
    matchId: UUID,
    slot: TimeInterval
  ): Promise<{
    bothAccepted: boolean;
    zoomMeetingId?: string;
    zoomLink?: string;
  }>;
}

export interface ZoomAdapter {
  isConfigured(): boolean;
  createMeeting(
    teacherAuth: { zoomClientId: string; zoomClientSecret: string; zoomRefreshToken: string },
    topic: string,
    startTime: ISOTimestamp,
    durationMinutes: number
  ): Promise<{ meetingId: string; joinUrl: string }>;
  validateWebhookSignature(rawBody: string, signature: string, timestamp: string): boolean;
}

export const lectureStatusSchema = z.enum(["live", "completed"]);

export const lectureSessionSchema = z.object({
  id: uuidSchema,
  courseId: uuidSchema,
  title: z.string().min(1),
  status: lectureStatusSchema,
  startedAt: isoTimestampSchema,
  endedAt: isoTimestampSchema.optional(),
});

export const transcriptChunkSchema = z.object({
  id: uuidSchema,
  lectureId: uuidSchema,
  text: z.string().min(1),
  timestampSec: z.number().nonnegative(),
  speakerName: z.string().optional(),
  detectedConceptIds: z.array(uuidSchema),
  createdAt: isoTimestampSchema,
});

export const pollStatusSchema = z.enum(["draft", "active", "closed"]);

export const pollQuestionSchema = z.object({
  id: uuidSchema,
  lectureId: uuidSchema,
  conceptId: uuidSchema,
  question: z.string().min(1),
  expectedAnswer: z.string().min(1),
  status: pollStatusSchema,
  generatedAt: isoTimestampSchema,
  activatedAt: isoTimestampSchema.optional(),
  closedAt: isoTimestampSchema.optional(),
});

export const pollResponseOutcomeSchema = z.enum(["correct", "partial", "wrong"]);

export const pollResponseEvaluationSchema = z.object({
  outcome: pollResponseOutcomeSchema,
  feedback: z.string(),
});

export const pollResponseResultSchema = z.object({
  responseId: uuidSchema,
  status: z.literal("evaluated"),
  evaluation: pollResponseEvaluationSchema,
  newConfidence: confidenceSchema,
  newBand: masteryBandSchema,
});

export const lectureSnapshotSchema = z.object({
  lecture: lectureSessionSchema,
  activePoll: pollQuestionSchema.nullable(),
  recentChunks: z.array(transcriptChunkSchema),
  activeConceptIds: z.array(uuidSchema),
});

export const transcriptIngestResponseSchema = z.object({
  chunkId: uuidSchema,
  detectedConceptIds: z.array(uuidSchema),
});

export const studyGroupOptInResponseSchema = z.object({
  status: z.enum(["waiting", "matched"]),
  matchId: uuidSchema.optional(),
  expiresAt: isoTimestampSchema,
});

export const timeIntervalSchema = z.object({
  startsAt: isoTimestampSchema,
  endsAt: isoTimestampSchema,
});

export const studyGroupMessageSchema = z.object({
  id: uuidSchema,
  senderId: uuidSchema,
  content: z.string().min(1),
  createdAt: isoTimestampSchema,
});
