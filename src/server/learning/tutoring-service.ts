import {
  type ActorContext,
  type UUID,
  type MasteryBand,
  type Clock,
  type IdGenerator,
  uuidSchema,
  masteryBandSchema,
} from "../../contracts/common.js";
import type { LearningService } from "../../contracts/learning.js";
import {
  createTutoringSessionRequestSchema,
  createTutoringSessionResponseSchema,
  submitTutoringMessageRequestSchema,
  submitTutoringMessageResponseSchema,
  type SubmitTutoringMessageResponse,
} from "../../contracts/learning.js";
import type { AiService } from "../../contracts/ai.js";
import {
  socraticTutorTurnResponseSchema,
  checkUnderstandingResponseSchema,
} from "../../contracts/ai.js";
import type { MasteryService } from "../../contracts/mastery.js";
import { confidenceSchema } from "../../contracts/mastery.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";
import type { TutoringRepositoryPort } from "./tutoring-repository.js";

export interface TutoringServiceDependencies {
  repository: TutoringRepositoryPort;
  ai: Pick<AiService, "socraticTutorTurn">;
  understandingChecker: Required<Pick<AiService, "checkUnderstanding">>;
  mastery: Pick<MasteryService, "applyEvidence">;
  ids: IdGenerator;
  clock: Clock;
}

export class TutoringService
  implements Pick<LearningService, "createTutoringSession" | "submitTutoringMessage">
{
  private readonly repository: TutoringRepositoryPort;
  private readonly ai: Pick<AiService, "socraticTutorTurn">;
  private readonly understandingChecker: Required<Pick<AiService, "checkUnderstanding">>;
  private readonly mastery: Pick<MasteryService, "applyEvidence">;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;

  constructor(deps: TutoringServiceDependencies) {
    this.repository = deps.repository;
    this.ai = deps.ai;
    this.understandingChecker = deps.understandingChecker;
    this.mastery = deps.mastery;
    this.ids = deps.ids;
    this.clock = deps.clock;
  }

  async createTutoringSession(
    actor: ActorContext,
    studentId: UUID,
    conceptIds: UUID[]
  ): Promise<{ sessionId: UUID }> {
    const requestValidation = createTutoringSessionRequestSchema.safeParse({
      studentId,
      conceptIds,
    });
    if (!requestValidation.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid create tutoring session request",
        cause: requestValidation.error,
      });
    }

    const sessionId = this.ids.generateId();
    if (!uuidSchema.safeParse(sessionId).success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Generated session ID is invalid",
      });
    }

    const startedAt = this.clock.nowISO();
    const session = await this.repository.createSession(
      actor,
      sessionId,
      studentId,
      conceptIds,
      startedAt
    );

    const response = { sessionId: session.id };
    return createTutoringSessionResponseSchema.parse(response);
  }

  async submitTutoringMessage(
    actor: ActorContext,
    sessionId: UUID,
    content: string,
    conceptId?: UUID
  ): Promise<SubmitTutoringMessageResponse> {
    if (!uuidSchema.safeParse(sessionId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid session ID format",
      });
    }

    const bodyValidation = submitTutoringMessageRequestSchema.safeParse({
      content,
      conceptId,
    });
    if (!bodyValidation.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid tutoring message submission request",
        cause: bodyValidation.error,
      });
    }

    if (content.trim().length === 0) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Tutoring message content cannot be whitespace only",
      });
    }

    const session = await this.repository.getSession(actor, sessionId);
    if (session.endedAt !== null) {
      throw new AppError({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
        message: "Tutoring session has ended",
      });
    }

    if (!session.targetConcepts || session.targetConcepts.length === 0) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Corrupt session state: session has no target concepts",
      });
    }

    let resolvedConceptId: UUID;
    if (conceptId) {
      if (!session.targetConcepts.includes(conceptId)) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: `Supplied conceptId ${conceptId} is not in session target concepts`,
        });
      }
      resolvedConceptId = conceptId;
    } else {
      resolvedConceptId = session.targetConcepts[0];
    }

    const concept = await this.repository.getConcept(actor, session.studentId, resolvedConceptId);

    // Prior messages before new user message is recorded
    const priorMessages = await this.repository.listMessages(actor, sessionId);
    const dialogHistory = priorMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const nowMs = this.clock.now().getTime();
    const lastMsgMs =
      priorMessages.length > 0
        ? Math.max(...priorMessages.map((m) => new Date(m.createdAt).getTime()))
        : -Infinity;

    const userTimeMs = Math.max(nowMs, lastMsgMs + 1);
    const userMessageId = this.ids.generateId();
    if (!uuidSchema.safeParse(userMessageId).success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Generated user message ID is invalid",
      });
    }

    await this.repository.insertMessage(actor, {
      id: userMessageId,
      sessionId,
      role: "user",
      content,
      conceptId: resolvedConceptId,
      understandingDetected: false,
      createdAt: new Date(userTimeMs).toISOString(),
    });

    // Invoke Socratic turn through AI provider
    const aiResult = await this.ai.socraticTutorTurn(concept, dialogHistory, content);
    const validatedAi = socraticTutorTurnResponseSchema.safeParse(aiResult);
    if (!validatedAi.success) {
      throw new AppError({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
        message: "AI tutor returned invalid response format",
        cause: validatedAi.error,
      });
    }

    let understandingConfirmed = false;
    if (validatedAi.data.understandingDetected) {
      let priorAssistantQuestion: string | undefined;
      for (let i = priorMessages.length - 1; i >= 0; i--) {
        const msg = priorMessages[i];
        if (
          msg.role === "assistant" &&
          msg.conceptId === resolvedConceptId &&
          msg.content.trim().length > 0
        ) {
          priorAssistantQuestion = msg.content;
          break;
        }
      }

      if (priorAssistantQuestion) {
        const checkerResult = await this.understandingChecker.checkUnderstanding(
          concept,
          priorAssistantQuestion,
          content
        );
        const validatedChecker = checkUnderstandingResponseSchema.safeParse(checkerResult);
        if (!validatedChecker.success) {
          throw new AppError({
            code: DomainErrorCode.BAD_GATEWAY,
            statusCode: 502,
            message: "AI understanding checker returned invalid response format",
            cause: validatedChecker.error,
          });
        }
        understandingConfirmed = validatedChecker.data.understandingConfirmed;
      }
    }

    const asstNowMs = this.clock.now().getTime();
    const asstTimeMs = Math.max(asstNowMs, userTimeMs + 1);
    const assistantMessageId = this.ids.generateId();
    if (!uuidSchema.safeParse(assistantMessageId).success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Generated assistant message ID is invalid",
      });
    }

    await this.repository.insertMessage(actor, {
      id: assistantMessageId,
      sessionId,
      role: "assistant",
      content: validatedAi.data.assistantResponse,
      conceptId: resolvedConceptId,
      understandingDetected: understandingConfirmed,
      createdAt: new Date(asstTimeMs).toISOString(),
    });

    let masteryUpdated: { confidence: number; band: MasteryBand } | undefined;
    if (understandingConfirmed) {
      masteryUpdated = await this.applyUnderstandingEvidence(actor, sessionId, assistantMessageId);
    }

    const response: SubmitTutoringMessageResponse = {
      assistantContent: validatedAi.data.assistantResponse,
      understandingDetected: understandingConfirmed,
      ...(masteryUpdated ? { masteryUpdated } : {}),
    };

    return submitTutoringMessageResponseSchema.parse(response);
  }

  async applyUnderstandingEvidence(
    actor: ActorContext,
    sessionId: UUID,
    assistantMessageId: UUID
  ): Promise<{ confidence: number; band: MasteryBand }> {
    const session = await this.repository.getSession(actor, sessionId);
    const message = await this.repository.getMessage(actor, sessionId, assistantMessageId);

    if (message.role !== "assistant") {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Evidence may only be applied from assistant messages",
      });
    }

    if (!message.understandingDetected) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Understanding was not detected in this message",
      });
    }

    if (!message.conceptId) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Assistant message does not have an associated concept",
      });
    }

    if (!session.targetConcepts.includes(message.conceptId)) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Concept is not in session target concepts",
      });
    }

    const masteryResult = await this.mastery.applyEvidence(
      actor,
      session.studentId,
      message.conceptId,
      {
        type: "tutor",
        sourceId: message.id,
      }
    );

    const validConfidence = confidenceSchema.safeParse(masteryResult.confidence);
    const validBand = masteryBandSchema.safeParse(masteryResult.band);

    if (!validConfidence.success || !validBand.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Mastery service returned invalid confidence or band",
      });
    }

    return {
      confidence: validConfidence.data,
      band: validBand.data,
    };
  }
}
