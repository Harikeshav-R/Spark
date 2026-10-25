import { randomInt as cryptoRandomInt } from "node:crypto";
import { z } from "zod";
import {
  type ActorContext,
  type UUID,
  type Clock,
  type IdGenerator,
  uuidSchema,
} from "../../contracts/common.js";
import {
  type EncounterDTO,
  type EncounterResultDTO,
  type CreateEncounterInput,
  type HintLevel,
  type EncounterQuestionDTO,
  type EncounterFeedbackItemDTO,
  type DailyQuestDTO,
  createEncounterInputSchema,
  encounterSchema,
  encounterResultSchema,
  hintLevelSchema,
} from "../../contracts/game.js";
import {
  type ConceptQuizQuestion,
  type StudentQuizQuestion,
} from "../../contracts/learning.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";
import type {
  GraphRepository,
  LearningEvidenceService,
  ConcreteGameService,
  GameRepository,
  MasteryService,
} from "../core/index.js";
import { hydrateDailyQuestItems } from "../core/index.js";
import type {
  GenerateQuizHintsAi,
} from "../ai/index.js";
import type { QuizService } from "./quiz-service.js";
import type { QuizRepositoryPort } from "./quiz-repository.js";
import type {
  EncounterRepositoryPort,
  EncounterRecord,
  NewEncounterRecord,
  OptionPermutation,
  EncounterAttemptRecord,
  NewEncounterAttemptRecord,
} from "./encounter-repository.js";

export interface EncounterServiceDependencies {
  courseId: UUID;
  topology: Pick<GraphRepository, "getTopology">;
  quizzes: Pick<QuizService, "getQuiz">;
  questions: Pick<QuizRepositoryPort, "getQuestionsByIds">;
  hints: Pick<GenerateQuizHintsAi, "generateQuizHints">;
  repository: EncounterRepositoryPort;
  evidence: Pick<LearningEvidenceService, "applyQuizAttempt">;
  game: Pick<ConcreteGameService, "recordPracticeReward" | "getSummary">;
  gameRepository: Pick<
    GameRepository,
    "getDailyQuestRow" | "getLatestCommittedReviews"
  >;
  mastery: Pick<MasteryService, "getMastery">;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
  randomInt?: (maxExclusive: number) => number;
}

const submitEncounterAnswersSchema = z
  .array(
    z.strictObject({
      questionId: uuidSchema,
      selectedOption: z.number().int().min(0).max(3),
    }),
  )
  .length(5);

function shufflePermutation(
  randomIntFn: (maxExclusive: number) => number,
): OptionPermutation {
  const arr: [number, number, number, number] = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = randomIntFn(i + 1);
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

export class EncounterService {
  private readonly randomInt: (maxExclusive: number) => number;

  constructor(private readonly deps: EncounterServiceDependencies) {
    this.randomInt = deps.randomInt ?? ((max: number) => cryptoRandomInt(max));
  }

  private async authorizeStudentAndCourse(
    actor: ActorContext,
    targetStudentId?: UUID,
  ): Promise<{ studentId: UUID }> {
    if (actor.role !== "student") {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Only enrolled students can access encounters",
      });
    }

    const enrollment = actor.enrolledCourses?.find(
      (e) => e.courseId === this.deps.courseId,
    );

    if (!enrollment) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Actor is not enrolled in the target course",
      });
    }

    if (targetStudentId && enrollment.studentId !== targetStudentId) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Actor student ID does not match target student ID",
      });
    }

    return { studentId: enrollment.studentId };
  }

  private async reconstructResult(
    actor: ActorContext,
    studentId: UUID,
    encounter: EncounterRecord,
    attempt: EncounterAttemptRecord,
    storedQuestions: readonly ConceptQuizQuestion[],
  ): Promise<EncounterResultDTO> {
    const grade = await this.deps.repository.getCommittedGrade(
      studentId,
      encounter.conceptId,
      attempt.id,
    );

    if (!grade) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Completed encounter is missing matching mastery evidence",
      });
    }

    const awardDate = attempt.submittedAt.slice(0, 10);
    const xpAwarded = await this.deps.repository.getAttemptXp(
      studentId,
      encounter.conceptId,
      attempt.id,
      awardDate,
    );

    const summary = await this.deps.game.getSummary(actor, studentId);

    let dailyQuest: DailyQuestDTO | null = null;
    const questRow = await this.deps.gameRepository.getDailyQuestRow(
      studentId,
      awardDate,
    );

    if (questRow) {
      const [masteries, latestReviews] = await Promise.all([
        this.deps.mastery.getMastery(actor, studentId),
        this.deps.gameRepository.getLatestCommittedReviews(studentId),
      ]);
      const masteryMap = new Map(
        masteries.map((m) => [m.conceptId, m.confidence]),
      );
      const hydratedItems = hydrateDailyQuestItems(
        questRow.conceptIds,
        questRow.completedIds,
        masteryMap,
        latestReviews,
        this.deps.clock.now(),
      );

      dailyQuest = {
        id: questRow.id,
        studentId: questRow.studentId,
        date: questRow.questDate,
        items: hydratedItems,
        clearedAt: questRow.clearedAt,
        version: questRow.version,
      };
    }

    const answerMap = new Map(
      attempt.submittedAnswers.map((a) => [a.questionId, a]),
    );

    const feedback: EncounterFeedbackItemDTO[] = encounter.questionIds.map(
      (qId, i) => {
        const storedQ = storedQuestions.find((q) => q.id === qId);
        if (!storedQ) {
          throw new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: `Stored question ${qId} missing during result feedback construction`,
          });
        }
        const answer = answerMap.get(qId);
        if (!answer) {
          throw new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: `Submitted answer missing for question ${qId}`,
          });
        }
        const perm = encounter.optionPermutations[i];
        const correctDisplayOption = perm.indexOf(storedQ.correctAnswer);

        return {
          questionId: qId,
          correct: answer.correct,
          correctOption: correctDisplayOption,
          explanation: storedQ.explanation,
        };
      },
    );

    const resultPayload: EncounterResultDTO = {
      encounterId: encounter.id,
      attemptId: attempt.id,
      score: attempt.score,
      correctCount: attempt.correctCount,
      totalQuestions: 5,
      newConfidence: grade.newConfidence,
      newBand: grade.newBand,
      feedback,
      xpAwarded,
      summary,
      dailyQuest,
    };

    const validatedResult = encounterResultSchema.safeParse(resultPayload);
    if (!validatedResult.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to construct valid encounter result schema",
        cause: validatedResult.error,
      });
    }

    return validatedResult.data;
  }

  async createEncounter(
    actor: ActorContext,
    studentId: UUID,
    input: CreateEncounterInput,
  ): Promise<EncounterDTO> {
    const parsedStudentId = uuidSchema.safeParse(studentId);
    if (!parsedStudentId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid studentId parameter",
        cause: parsedStudentId.error,
      });
    }

    const parsedInput = createEncounterInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid create encounter input",
        cause: parsedInput.error,
      });
    }

    const validatedInput = parsedInput.data;
    const { studentId: authStudentId } = await this.authorizeStudentAndCourse(
      actor,
      parsedStudentId.data,
    );

    if (validatedInput.source === "party") {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Party encounters are not available until Phase 6",
      });
    }

    const topology = await this.deps.topology.getTopology(
      actor,
      this.deps.courseId,
    );
    const concept = topology.nodes.find(
      (c) => c.id === validatedInput.conceptId,
    );
    if (!concept) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Concept not found in course topology",
      });
    }

    if (validatedInput.source === "daily") {
      const todayDate = this.deps.clock.now().toISOString().slice(0, 10);
      const questRow = await this.deps.gameRepository.getDailyQuestRow(
        authStudentId,
        todayDate,
      );

      if (
        !questRow ||
        questRow.id !== validatedInput.questId ||
        !questRow.conceptIds.includes(validatedInput.conceptId)
      ) {
        throw new AppError({
          code: DomainErrorCode.NOT_FOUND,
          statusCode: 404,
          message: "Matching daily quest not found for this concept and date",
        });
      }
    }

    const publicQuestions: StudentQuizQuestion[] =
      await this.deps.quizzes.getQuiz(actor, validatedInput.conceptId);

    if (!Array.isArray(publicQuestions) || publicQuestions.length !== 5) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Quiz question bank did not return 5 questions",
      });
    }

    const questionIds = publicQuestions.map((q) => q.id);
    const storedQuestions = await this.deps.questions.getQuestionsByIds(
      validatedInput.conceptId,
      questionIds,
    );

    if (
      storedQuestions.length !== 5 ||
      storedQuestions.some((q) => q.conceptId !== validatedInput.conceptId)
    ) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Stored quiz questions do not match requested concept",
      });
    }

    // Ensure questions are in canonical order matching questionIds
    const orderedStoredQuestions = questionIds.map((qId) => {
      const q = storedQuestions.find((item) => item.id === qId);
      if (!q) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: `Stored question ${qId} missing from question bank`,
        });
      }
      return q;
    });

    const hintsMap = await this.deps.repository.getQuestionHints(
      validatedInput.conceptId,
      questionIds,
    );

    const hasMissingHints = questionIds.some((id) => !hintsMap.get(id));
    if (hasMissingHints) {
      const generatedHints = await this.deps.hints.generateQuizHints(
        concept,
        orderedStoredQuestions,
      );
      await this.deps.repository.storeMissingQuestionHints(
        validatedInput.conceptId,
        generatedHints,
      );
    }

    const perms: [
      OptionPermutation,
      OptionPermutation,
      OptionPermutation,
      OptionPermutation,
      OptionPermutation,
    ] = [
      shufflePermutation(this.randomInt),
      shufflePermutation(this.randomInt),
      shufflePermutation(this.randomInt),
      shufflePermutation(this.randomInt),
      shufflePermutation(this.randomInt),
    ];

    const encounterId = this.deps.ids.generateId();
    const nowISO = this.deps.clock.nowISO();

    const newEncounter: NewEncounterRecord = {
      id: encounterId,
      studentId: authStudentId,
      conceptId: validatedInput.conceptId,
      source: validatedInput.source,
      questId: validatedInput.source === "daily" ? validatedInput.questId : null,
      partyQuestId: null,
      questionIds: [
        questionIds[0],
        questionIds[1],
        questionIds[2],
        questionIds[3],
        questionIds[4],
      ],
      optionPermutations: perms,
      hintsUsed: [0, 0, 0, 0, 0],
      createdAt: nowISO,
      updatedAt: nowISO,
    };

    const created = await this.deps.repository.insertEncounter(newEncounter);

    const encounterQuestions: EncounterQuestionDTO[] = created.questionIds.map(
      (qId, i) => {
        const storedQ = orderedStoredQuestions[i];
        const canonicalOptions = [
          storedQ.optionA,
          storedQ.optionB,
          storedQ.optionC,
          storedQ.optionD,
        ];
        const perm = created.optionPermutations[i];
        return {
          questionId: qId,
          question: storedQ.question,
          options: [
            canonicalOptions[perm[0]],
            canonicalOptions[perm[1]],
            canonicalOptions[perm[2]],
            canonicalOptions[perm[3]],
          ],
          hintsUsed: created.hintsUsed[i],
        };
      },
    );

    const resultDTO: EncounterDTO = {
      id: created.id,
      studentId: created.studentId,
      conceptId: created.conceptId,
      source: created.source,
      questId: created.questId,
      partyQuestId: created.partyQuestId,
      status: created.status,
      questions: encounterQuestions,
      version: created.version,
    };

    return encounterSchema.parse(resultDTO);
  }

  async getEncounter(
    actor: ActorContext,
    encounterId: UUID,
  ): Promise<{ encounter: EncounterDTO; result: EncounterResultDTO | null }> {
    const parsedEncounterId = uuidSchema.safeParse(encounterId);
    if (!parsedEncounterId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid encounter ID",
      });
    }

    const { studentId } = await this.authorizeStudentAndCourse(actor);
    const topology = await this.deps.topology.getTopology(
      actor,
      this.deps.courseId,
    );

    const encounter = await this.deps.repository.getEncounter(
      studentId,
      parsedEncounterId.data,
    );

    if (!encounter) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Encounter not found",
      });
    }

    const concept = topology.nodes.find((c) => c.id === encounter.conceptId);
    if (!concept) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Concept not found in course topology",
      });
    }

    const storedQuestions = await this.deps.questions.getQuestionsByIds(
      encounter.conceptId,
      encounter.questionIds,
    );

    if (storedQuestions.length !== 5) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Stored questions missing for encounter",
      });
    }

    const encounterQuestions: EncounterQuestionDTO[] = encounter.questionIds.map(
      (qId, i) => {
        const storedQ = storedQuestions.find((q) => q.id === qId);
        if (!storedQ) {
          throw new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: `Stored question ${qId} missing from bank`,
          });
        }
        const canonicalOptions = [
          storedQ.optionA,
          storedQ.optionB,
          storedQ.optionC,
          storedQ.optionD,
        ];
        const perm = encounter.optionPermutations[i];
        return {
          questionId: qId,
          question: storedQ.question,
          options: [
            canonicalOptions[perm[0]],
            canonicalOptions[perm[1]],
            canonicalOptions[perm[2]],
            canonicalOptions[perm[3]],
          ],
          hintsUsed: encounter.hintsUsed[i],
        };
      },
    );

    const encounterDTO: EncounterDTO = encounterSchema.parse({
      id: encounter.id,
      studentId: encounter.studentId,
      conceptId: encounter.conceptId,
      source: encounter.source,
      questId: encounter.questId,
      partyQuestId: encounter.partyQuestId,
      status: encounter.status,
      questions: encounterQuestions,
      version: encounter.version,
    });

    if (encounter.status !== "completed") {
      return { encounter: encounterDTO, result: null };
    }

    const attempt = await this.deps.repository.getAttempt(
      studentId,
      encounter.id,
    );
    if (!attempt) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Completed encounter is missing linked attempt",
      });
    }

    const result = await this.reconstructResult(
      actor,
      studentId,
      encounter,
      attempt,
      storedQuestions,
    );

    return { encounter: encounterDTO, result };
  }

  async getHint(
    actor: ActorContext,
    encounterId: UUID,
    questionId: UUID,
    level: HintLevel,
  ): Promise<{ questionId: UUID; level: HintLevel; text: string }> {
    const parsedLevel = hintLevelSchema.safeParse(level);
    if (
      !parsedLevel.success ||
      typeof level !== "number" ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > 3
    ) {
      throw new AppError({
        code: "INVALID_HINT_LEVEL",
        statusCode: 400,
        message: "Invalid hint level; must be 1, 2, or 3",
      });
    }

    const parsedEncounterId = uuidSchema.safeParse(encounterId);
    const parsedQuestionId = uuidSchema.safeParse(questionId);
    if (!parsedEncounterId.success || !parsedQuestionId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid UUID parameter for getHint",
      });
    }

    const { studentId } = await this.authorizeStudentAndCourse(actor);
    await this.deps.topology.getTopology(actor, this.deps.courseId);

    for (let retry = 0; retry < 8; retry++) {
      const encounter = await this.deps.repository.getEncounter(
        studentId,
        parsedEncounterId.data,
      );

      if (!encounter) {
        throw new AppError({
          code: DomainErrorCode.NOT_FOUND,
          statusCode: 404,
          message: "Encounter not found",
        });
      }

      if (encounter.status !== "active") {
        throw new AppError({
          code: "ENCOUNTER_ALREADY_SUBMITTED",
          statusCode: 409,
          message: "Encounter already submitted or inactive",
        });
      }

      const existingAttempt = await this.deps.repository.getAttempt(
        studentId,
        parsedEncounterId.data,
      );
      if (existingAttempt !== null) {
        throw new AppError({
          code: "ENCOUNTER_ALREADY_SUBMITTED",
          statusCode: 409,
          message: "Encounter already submitted",
        });
      }

      const qIndex = encounter.questionIds.indexOf(parsedQuestionId.data);
      if (qIndex === -1) {
        throw new AppError({
          code: DomainErrorCode.NOT_FOUND,
          statusCode: 404,
          message: "Question not found in encounter",
        });
      }

      const currentHints = encounter.hintsUsed[qIndex];
      const requestedLevel = parsedLevel.data;

      if (requestedLevel > currentHints + 1) {
        throw new AppError({
          code: "HINT_OUT_OF_SEQUENCE",
          statusCode: 409,
          message: `Hint level out of sequence: cannot request level ${requestedLevel} when current is ${currentHints}`,
        });
      }

      const hintsMap = await this.deps.repository.getQuestionHints(
        encounter.conceptId,
        [parsedQuestionId.data],
      );
      const hintsTuple = hintsMap.get(parsedQuestionId.data);

      if (!hintsTuple) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Hints not found for question",
        });
      }

      if (requestedLevel <= currentHints) {
        return {
          questionId: parsedQuestionId.data,
          level: requestedLevel,
          text: hintsTuple[requestedLevel - 1],
        };
      }

      // requestedLevel === currentHints + 1: increment via CAS
      const newHintsUsed: [number, number, number, number, number] = [
        ...encounter.hintsUsed,
      ];
      newHintsUsed[qIndex] = requestedLevel;

      const casResult = await this.deps.repository.compareAndSwapEncounter(
        studentId,
        parsedEncounterId.data,
        encounter.version,
        { hintsUsed: newHintsUsed },
        this.deps.clock.nowISO(),
      );

      if (!casResult) {
        // CAS contention: retry loop
        continue;
      }

      return {
        questionId: parsedQuestionId.data,
        level: requestedLevel,
        text: hintsTuple[requestedLevel - 1],
      };
    }

    throw new AppError({
      code: DomainErrorCode.CONFLICT,
      statusCode: 409,
      message: "High contention on encounter hints update",
    });
  }

  async submitEncounter(
    actor: ActorContext,
    encounterId: UUID,
    answers: { questionId: UUID; selectedOption: number }[],
  ): Promise<EncounterResultDTO> {
    const parsedEncounterId = uuidSchema.safeParse(encounterId);
    if (!parsedEncounterId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid encounter ID",
      });
    }

    const parsedAnswers = submitEncounterAnswersSchema.safeParse(answers);
    if (!parsedAnswers.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid answers array provided for submission",
        cause: parsedAnswers.error,
      });
    }

    const { studentId } = await this.authorizeStudentAndCourse(actor);
    await this.deps.topology.getTopology(actor, this.deps.courseId);

    const encounter = await this.deps.repository.getEncounter(
      studentId,
      parsedEncounterId.data,
    );

    if (!encounter) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Encounter not found",
      });
    }

    const answerQuestionIds = new Set(parsedAnswers.data.map((a) => a.questionId));
    if (
      answerQuestionIds.size !== 5 ||
      !encounter.questionIds.every((id) => answerQuestionIds.has(id))
    ) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Answers array must match all encounter questions exactly",
      });
    }

    const answerMap = new Map(
      parsedAnswers.data.map((a) => [a.questionId, a.selectedOption]),
    );

    const storedQuestions = await this.deps.questions.getQuestionsByIds(
      encounter.conceptId,
      encounter.questionIds,
    );

    if (storedQuestions.length !== 5) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Stored questions missing for encounter submission",
      });
    }

    // Grade answers in encounter.questionIds order
    const orderedGraded = encounter.questionIds.map((qId, i) => {
      const storedQ = storedQuestions.find((q) => q.id === qId);
      if (!storedQ) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: `Stored question ${qId} missing`,
        });
      }
      const displayOption = answerMap.get(qId)!;
      const perm = encounter.optionPermutations[i];
      const canonicalSelectedOption = perm[displayOption];
      const correct = canonicalSelectedOption === storedQ.correctAnswer;

      return {
        questionId: qId,
        selectedOption: canonicalSelectedOption,
        correct,
      };
    });

    const correctCount = orderedGraded.filter((a) => a.correct).length;
    const score = correctCount / 5;

    // Check existing attempt first
    const existingAttempt = await this.deps.repository.getAttempt(
      studentId,
      parsedEncounterId.data,
    );

    let activeAttempt: EncounterAttemptRecord;

    if (existingAttempt) {
      // Validate identical answers for idempotent replay
      const answersMatch =
        existingAttempt.submittedAnswers.length === 5 &&
        existingAttempt.submittedAnswers.every(
          (ea, idx) =>
            ea.questionId === orderedGraded[idx].questionId &&
            ea.selectedOption === orderedGraded[idx].selectedOption,
        );

      if (!answersMatch) {
        throw new AppError({
          code: "ENCOUNTER_ALREADY_SUBMITTED",
          statusCode: 409,
          message: "Encounter has already been submitted with different answers",
        });
      }

      activeAttempt = existingAttempt;
    } else {
      const newAttempt: NewEncounterAttemptRecord = {
        id: this.deps.ids.generateId(),
        studentId,
        conceptId: encounter.conceptId,
        score,
        correctCount,
        totalQuestions: 5,
        encounterId: encounter.id,
        submittedAnswers: orderedGraded,
        submittedAt: this.deps.clock.nowISO(),
      };

      const admitted = await this.deps.repository.insertAttempt(newAttempt);

      // Verify winning attempt on possible 23505 race
      const answersMatch =
        admitted.submittedAnswers.length === 5 &&
        admitted.submittedAnswers.every(
          (ea, idx) =>
            ea.questionId === orderedGraded[idx].questionId &&
            ea.selectedOption === orderedGraded[idx].selectedOption,
        );

      if (!answersMatch) {
        throw new AppError({
          code: DomainErrorCode.CONFLICT,
          statusCode: 409,
          message: "Encounter has already been submitted with different answers",
        });
      }

      activeAttempt = admitted;
    }

    // Freeze in-flight hints with version fence CAS
    let currentEncounter = encounter;
    for (let retry = 0; retry < 8; retry++) {
      const fresh = await this.deps.repository.getEncounter(
        studentId,
        parsedEncounterId.data,
      );
      if (!fresh) break;
      currentEncounter = fresh;
      if (fresh.status !== "active") break;

      const fenced = await this.deps.repository.compareAndSwapEncounter(
        studentId,
        parsedEncounterId.data,
        fresh.version,
        {}, // empty patch: bump version/updatedAt
        this.deps.clock.nowISO(),
      );

      if (fenced !== null) {
        currentEncounter = fenced;
        break;
      }
    }

    // 1. Apply mastery evidence
    await this.deps.evidence.applyQuizAttempt(
      actor,
      this.deps.courseId,
      activeAttempt.id,
    );

    // 2. Apply game progression reward
    const rewardAnswers = orderedGraded.map((item, i) => ({
      correct: item.correct,
      hintsUsed: currentEncounter.hintsUsed[i],
    }));

    await this.deps.game.recordPracticeReward(
      actor,
      studentId,
      activeAttempt.id,
      rewardAnswers,
    );

    // 3. Mark encounter completed via CAS if still active
    if (currentEncounter.status === "active") {
      const completedEncounter =
        await this.deps.repository.compareAndSwapEncounter(
          studentId,
          parsedEncounterId.data,
          currentEncounter.version,
          { status: "completed" },
          this.deps.clock.nowISO(),
        );
      if (completedEncounter) {
        currentEncounter = completedEncounter;
      }
    }

    return await this.reconstructResult(
      actor,
      studentId,
      currentEncounter,
      activeAttempt,
      storedQuestions,
    );
  }
}
