import { z } from "zod";
import type { AiService } from "../../contracts/ai.js";
import type {
  ClassroomService,
  TranscriptChunk,
} from "../../contracts/classroom.js";
import { transcriptChunkSchema } from "../../contracts/classroom.js";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import type {
  ConceptDetectedEvent,
  RealtimePublisher,
  TranscriptChunkEvent,
} from "../../contracts/realtime.js";
import {
  conceptDetectedEventSchema,
  transcriptChunkEventSchema,
} from "../../contracts/realtime.js";
import type { RoomAuthorizer, PresenceTracker } from "../realtime/index.js";
import type { AttendanceEvidenceService } from "../core/index.js";
import type { LectureRepository } from "./lecture-repository.js";
import type { TranscriptRepository } from "./transcript-repository.js";
export interface TranscriptIngestorDependencies {
  lectures: Pick<LectureRepository, "getLecture">;
  transcripts: Pick<
    TranscriptRepository,
    "getCandidateConcepts" | "insertChunk" | "insertConceptLinks" | "getRecentTranscriptText"
  >;
  rooms: RoomAuthorizer;
  ai: Pick<AiService, "detectConcepts">;
  presence: Pick<PresenceTracker, "getAttendingStudentIds">;
  attendance: Pick<AttendanceEvidenceService, "recordChunkAttendance">;
  publisher: Pick<RealtimePublisher, "emitToLecture">;
  ids: Pick<IdGenerator, "generateId">;
  clock: Clock;
}

export class TranscriptIngestor implements Pick<ClassroomService, "ingestTranscriptChunk"> {
  constructor(private readonly deps: TranscriptIngestorDependencies) {}

  async ingestTranscriptChunk(
    actor: ActorContext,
    lectureId: UUID,
    text: string,
    timestampSec: number,
    speakerName?: string,
    provenance?: { isSimulated: boolean },
  ): Promise<TranscriptChunk> {
    // 1. Validate before persistence
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    if (typeof text !== "string" || text.trim().length === 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Transcript text must not be empty or whitespace only",
      });
    }

    if (typeof timestampSec !== "number" || !Number.isFinite(timestampSec) || timestampSec < 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Timestamp seconds must be a finite non-negative number",
      });
    }

    if (speakerName !== undefined) {
      if (typeof speakerName !== "string" || speakerName.length > 100) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Speaker name must be a string of at most 100 characters",
        });
      }
    }
    if (provenance !== undefined) {
      const provSchema = z.object({ isSimulated: z.boolean() }).strict();
      const parsedProv = provSchema.safeParse(provenance);
      if (!parsedProv.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid provenance payload",
          cause: parsedProv.error,
        });
      }
    }


    // 2. Authorize actor
    if (!actor || actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can ingest transcript chunks",
      });
    }

    await this.deps.rooms.authorizeRoom(actor, `professor:${lectureId}`);

    // 3. Verify lecture is live
    const lecture = await this.deps.lectures.getLecture(lectureId);
    if (lecture.status !== "live") {
      throw new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Cannot ingest transcript chunks into an inactive lecture",
      });
    }

    // 4. Snapshot attendees at start of chunk processing
    const attendingStudentIds = this.deps.presence.getAttendingStudentIds(lectureId);

    // 5. Persistence of raw chunk
    const candidates = await this.deps.transcripts.getCandidateConcepts(lecture.courseId);
    const chunkId = this.deps.ids.generateId();
    const createdAt = this.deps.clock.nowISO();

    const chunkToInsert: TranscriptChunk = {
      id: chunkId,
      lectureId,
      text,
      timestampSec,
      detectedConceptIds: [],
      createdAt,
    };
    if (speakerName !== undefined) {
      chunkToInsert.speakerName = speakerName;
    }
    if (provenance !== undefined) {
      chunkToInsert.isSimulated = provenance.isSimulated;
    }
    const storedChunk = await this.deps.transcripts.insertChunk(chunkToInsert);

    // 6. Concept detection
    const acceptedConceptIds: UUID[] = [];
    if (candidates.length > 0) {
      const candidateIdSet = new Set(candidates.map((c) => c.id));
      const windowText = await this.deps.transcripts.getRecentTranscriptText(
        storedChunk.lectureId,
        storedChunk.timestampSec,
      );
      const detectedResult = await this.deps.ai.detectConcepts(windowText, candidates);

      const parsedDetected = z.array(uuidSchema).safeParse(detectedResult);
      if (!parsedDetected.success) {
        throw new AppError({
          code: "BAD_GATEWAY",
          statusCode: 502,
          message: "AI concept detection returned invalid concept IDs",
          cause: parsedDetected.error,
        });
      }

      const seen = new Set<string>();
      for (const id of parsedDetected.data) {
        if (candidateIdSet.has(id) && !seen.has(id)) {
          seen.add(id);
          acceptedConceptIds.push(id);
        }
      }

      if (acceptedConceptIds.length > 0) {
        await this.deps.transcripts.insertConceptLinks(storedChunk.id, acceptedConceptIds);
      }
    }

    // 7. Record attendance evidence before broadcasting
    if (acceptedConceptIds.length > 0 && attendingStudentIds.length > 0) {
      await this.deps.attendance.recordChunkAttendance(
        actor,
        lecture.courseId,
        lectureId,
        storedChunk.id,
        attendingStudentIds,
      );
    }

    // 8. Broadcast events (persisted before publish)
    const chunkEvent: TranscriptChunkEvent = {
      eventId: this.deps.ids.generateId(),
      occurredAt: this.deps.clock.nowISO(),
      chunkId: storedChunk.id,
      lectureId: storedChunk.lectureId,
      text: storedChunk.text,
      timestampSec: storedChunk.timestampSec,
    };
    if (storedChunk.speakerName !== undefined) {
      chunkEvent.speakerName = storedChunk.speakerName;
    }
    if (storedChunk.isSimulated !== undefined) {
      chunkEvent.isSimulated = storedChunk.isSimulated;
    }
    const validatedChunkEvent = transcriptChunkEventSchema.parse(chunkEvent);

    const conceptEvent: ConceptDetectedEvent = {
      eventId: this.deps.ids.generateId(),
      occurredAt: this.deps.clock.nowISO(),
      lectureId: storedChunk.lectureId,
      conceptIds: acceptedConceptIds,
    };
    const validatedConceptEvent = conceptDetectedEventSchema.parse(conceptEvent);

    await this.deps.publisher.emitToLecture(lectureId, "transcript:chunk", validatedChunkEvent);
    await this.deps.publisher.emitToLecture(
      lectureId,
      "lecture:concept-detected",
      validatedConceptEvent,
    );
    // 9. Return stored chunk with detected concept IDs
    const finalChunk: TranscriptChunk = {
      ...storedChunk,
      detectedConceptIds: acceptedConceptIds,
    };
    return transcriptChunkSchema.parse(finalChunk);
  }
}
