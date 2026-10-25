import { describe, it, expect, vi } from "vitest";
import type { UUID } from "../../../src/contracts/common.js";
import type { ConceptNode } from "../../../src/contracts/course.js";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  SocraticTutorAi,
  CheckUnderstandingAi,
} from "../../../src/server/ai/index.js";
import {
  TutoringService,
} from "../../../src/server/learning/index.js";
import {
  FIXTURE_COURSE_ID,
  FIXTURE_STUDENT_ID,
  FIXTURE_CONCEPT_1,
  FIXTURE_CONCEPT_2,
  createStudentActor,
  InMemoryTutoringRepository,
  TestMasteryService,
  SequentialIdGenerator,
  FrozenClock,
} from "./helpers/tutoring-harness.js";

const FIXTURE_CONCEPT_DERIVATIVES: UUID = "33333333-3333-4333-8333-333333333303";

function setupDerivativesRepository(): InMemoryTutoringRepository {
  const repository = new InMemoryTutoringRepository();
  repository.concepts.set(FIXTURE_CONCEPT_DERIVATIVES, {
    id: FIXTURE_CONCEPT_DERIVATIVES,
    courseId: FIXTURE_COURSE_ID,
    label: "Derivatives",
    description: "Instantaneous rate of change defined by the limit of a difference quotient.",
    category: "Calculus",
    difficulty: 2,
    createdAt: "2026-10-21T12:00:00.000Z",
  });
  return repository;
}

describe("P5-C-01: Socratic Tutoring & Understanding Verification", () => {
  // Check 1: Derivative breakthrough
  it("advances mastery on verified derivative explanation following prior tutor question", async () => {
    const repository = setupDerivativesRepository();
    const mastery = new TestMasteryService(0.2);
    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const ai = new SocraticTutorAi(client);
    const understandingChecker = new CheckUnderstandingAi(client);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const service = new TutoringService({
      repository,
      ai,
      understandingChecker,
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_DERIVATIVES]
    );

    // Turn 1: student is unsure
    const firstTurn = await service.submitTutoringMessage(actor, sessionId, "I am unsure");
    expect(firstTurn.understandingDetected).toBe(false);
    expect(firstTurn.masteryUpdated).toBeUndefined();
    expect(mastery.state.confidence).toBe(0.2);
    expect(mastery.state.attempts).toBe(1);
    expect(mastery.state.version).toBe(1);

    // Turn 2: supported derivative explanation
    const secondTurn = await service.submitTutoringMessage(
      actor,
      sessionId,
      "A derivative is the instantaneous rate of change: the limit of the difference quotient as the input change approaches zero."
    );
    expect(secondTurn.understandingDetected).toBe(true);
    expect(secondTurn.masteryUpdated).toEqual({
      confidence: 0.4,
      band: "yellow",
    });

    // Verify stored messages
    const messages = await repository.listMessages(actor, sessionId);
    expect(messages).toHaveLength(4);
    const secondAssistant = messages[3];
    expect(secondAssistant.role).toBe("assistant");
    expect(secondAssistant.conceptId).toBe(FIXTURE_CONCEPT_DERIVATIVES);
    expect(secondAssistant.understandingDetected).toBe(true);

    // Verify mastery state
    expect(mastery.state.confidence).toBe(0.4);
    expect(mastery.state.band).toBe("yellow");
    expect(mastery.state.attempts).toBe(1);
    expect(mastery.state.version).toBe(2);
    expect(mastery.seenEvidenceKeys.size).toBe(1);
    expect(
      mastery.seenEvidenceKeys.has(
        `tutor:${secondAssistant.id}:${FIXTURE_STUDENT_ID}:${FIXTURE_CONCEPT_DERIVATIVES}`
      )
    ).toBe(true);
  });

  // Check 2: Independent veto
  it("vetoes understanding credit and mastery when fixture checker rejects candidate", async () => {
    const repository = new InMemoryTutoringRepository();
    const mastery = new TestMasteryService(0.2);
    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const ai = new SocraticTutorAi(client);
    const understandingChecker = new CheckUnderstandingAi(client);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const service = new TutoringService({
      repository,
      ai,
      understandingChecker,
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1]
    );

    // Turn 1: student unsure
    await service.submitTutoringMessage(actor, sessionId, "I am unsure");

    // Turn 2: keyword-only activation (generator flags candidate, checker vetoes)
    const result = await service.submitTutoringMessage(actor, sessionId, "activation");

    expect(result.understandingDetected).toBe(false);
    expect(result.masteryUpdated).toBeUndefined();

    const messages = await repository.listMessages(actor, sessionId);
    const latestAssistant = messages[messages.length - 1];
    expect(latestAssistant.role).toBe("assistant");
    expect(latestAssistant.understandingDetected).toBe(false);

    expect(mastery.state.confidence).toBe(0.2);
    expect(mastery.state.attempts).toBe(1);
    expect(mastery.state.version).toBe(1);
    expect(mastery.seenEvidenceKeys.size).toBe(0);
  });

  it("vetoes understanding credit and mastery when scripted checker rejects generator candidate", async () => {
    const repository = new InMemoryTutoringRepository();
    const mastery = new TestMasteryService(0.2);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const mockAi = {
      socraticTutorTurn: async () => ({
        assistantResponse: "How does the chain rule apply across hidden layers?",
        understandingDetected: true,
      }),
    };

    const mockChecker = {
      checkUnderstanding: async () => ({
        understandingConfirmed: false,
        rationale: "The answer does not explain the mechanism.",
      }),
    };

    const service = new TutoringService({
      repository,
      ai: mockAi,
      understandingChecker: mockChecker,
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1]
    );

    await repository.insertMessage(actor, {
      id: "00000000-0000-4000-8000-999999999991",
      sessionId,
      role: "assistant",
      content: "Can you explain how gradients propagate backwards?",
      conceptId: FIXTURE_CONCEPT_1,
      understandingDetected: false,
      createdAt: "2026-10-21T12:00:00.000Z",
    });

    const result = await service.submitTutoringMessage(
      actor,
      sessionId,
      "It uses activation weights.",
      FIXTURE_CONCEPT_1
    );

    expect(result.understandingDetected).toBe(false);
    expect(result.masteryUpdated).toBeUndefined();

    const messages = await repository.listMessages(actor, sessionId);
    const latestAssistant = messages[messages.length - 1];
    expect(latestAssistant.role).toBe("assistant");
    expect(latestAssistant.understandingDetected).toBe(false);

    expect(mastery.state.confidence).toBe(0.2);
    expect(mastery.state.attempts).toBe(1);
    expect(mastery.state.version).toBe(1);
    expect(mastery.seenEvidenceKeys.size).toBe(0);
  });

  // Check 3: No candidate and no prior question
  it("never calls checker and awards no credit when generator detects no candidate", async () => {
    const repository = new InMemoryTutoringRepository();
    const mastery = new TestMasteryService(0.2);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const checkerSpy = vi.fn().mockResolvedValue({
      understandingConfirmed: true,
      rationale: "Should not be called",
    });

    const service = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "What happens next?",
          understandingDetected: false,
        }),
      },
      understandingChecker: { checkUnderstanding: checkerSpy },
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1]
    );

    const result = await service.submitTutoringMessage(actor, sessionId, "I am unsure");
    expect(result.understandingDetected).toBe(false);
    expect(result.masteryUpdated).toBeUndefined();
    expect(checkerSpy).not.toHaveBeenCalled();
    expect(mastery.state.confidence).toBe(0.2);
  });

  it("skips checker and awards no credit on first-turn candidate without prior assistant question", async () => {
    const repository = new InMemoryTutoringRepository();
    const mastery = new TestMasteryService(0.2);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const checkerSpy = vi.fn().mockResolvedValue({
      understandingConfirmed: true,
      rationale: "Should not be called on first turn",
    });

    const service = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "Good initial thought.",
          understandingDetected: true,
        }),
      },
      understandingChecker: { checkUnderstanding: checkerSpy },
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1]
    );

    // Turn 1 has no prior assistant message in session
    const result = await service.submitTutoringMessage(
      actor,
      sessionId,
      "The chain rule combines local gradients through intermediate activations"
    );

    expect(result.understandingDetected).toBe(false);
    expect(result.masteryUpdated).toBeUndefined();
    expect(checkerSpy).not.toHaveBeenCalled();

    const messages = await repository.listMessages(actor, sessionId);
    expect(messages[1].understandingDetected).toBe(false);
    expect(mastery.state.confidence).toBe(0.2);
    expect(mastery.seenEvidenceKeys.size).toBe(0);
  });

  // Check 4: Concept-specific question
  it("only matches prior assistant questions matching the resolved concept", async () => {
    const repository = new InMemoryTutoringRepository();
    const mastery = new TestMasteryService(0.2);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const receivedQuestions: string[] = [];
    const mockChecker = {
      checkUnderstanding: async (
        concept: ConceptNode,
        tutorQuestion: string,
        _studentAnswer: string
      ) => {
        receivedQuestions.push(tutorQuestion);
        return {
          understandingConfirmed: concept.id === FIXTURE_CONCEPT_1 && tutorQuestion.includes("Backprop"),
          rationale: "Matching concept question required",
        };
      },
    };

    const service = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "Let us reflect on that.",
          understandingDetected: true,
        }),
      },
      understandingChecker: mockChecker,
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1, FIXTURE_CONCEPT_2]
    );

    // Seed prior assistant question for Concept 1
    await repository.insertMessage(actor, {
      id: "00000000-0000-4000-8000-000000000010",
      sessionId,
      role: "assistant",
      content: "Explain Backprop chain rule details.",
      conceptId: FIXTURE_CONCEPT_1,
      understandingDetected: false,
      createdAt: "2026-10-21T12:00:00.000Z",
    });

    // Seed later assistant question for Concept 2
    await repository.insertMessage(actor, {
      id: "00000000-0000-4000-8000-000000000020",
      sessionId,
      role: "assistant",
      content: "Explain Gradient Descent step size.",
      conceptId: FIXTURE_CONCEPT_2,
      understandingDetected: false,
      createdAt: "2026-10-21T12:01:00.000Z",
    });

    // Submit message targeting Concept 1 (not the latest Concept 2 message)
    const result = await service.submitTutoringMessage(
      actor,
      sessionId,
      "Backpropagation details explained",
      FIXTURE_CONCEPT_1
    );

    expect(result.understandingDetected).toBe(true);
    expect(result.masteryUpdated).toEqual({
      confidence: 0.4,
      band: "yellow",
    });
    expect(receivedQuestions).toEqual(["Explain Backprop chain rule details."]);

    const messages = await repository.listMessages(actor, sessionId);
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.conceptId).toBe(FIXTURE_CONCEPT_1);
    expect(lastMsg.understandingDetected).toBe(true);
  });

  // Check 5: Verifier trust boundary
  it("fails with 502 BAD_GATEWAY and leaves user message stored when checker returns schema-invalid response", async () => {
    const repository = new InMemoryTutoringRepository();
    const mastery = new TestMasteryService(0.2);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const invalidChecker = {
      checkUnderstanding: async () =>
        ({
          understandingConfirmed: "not-a-boolean",
          rationale: "x".repeat(300), // Exceeds 250 limit
        } as unknown as { understandingConfirmed: boolean; rationale: string }),
    };

    const service = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "Checking answer...",
          understandingDetected: true,
        }),
      },
      understandingChecker: invalidChecker,
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1]
    );

    await repository.insertMessage(actor, {
      id: "00000000-0000-4000-8000-000000000030",
      sessionId,
      role: "assistant",
      content: "Prior question",
      conceptId: FIXTURE_CONCEPT_1,
      understandingDetected: false,
      createdAt: "2026-10-21T12:00:00.000Z",
    });

    await expect(
      service.submitTutoringMessage(actor, sessionId, "Student response", FIXTURE_CONCEPT_1)
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(502);
      expect((err as AppError).code).toBe(DomainErrorCode.BAD_GATEWAY);
      return true;
    });

    // User message is persisted; assistant message is NOT persisted; mastery untouched
    const messages = await repository.listMessages(actor, sessionId);
    expect(messages).toHaveLength(2); // seeded assistant + user message
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("Student response");
    expect(mastery.state.confidence).toBe(0.2);
    expect(mastery.seenEvidenceKeys.size).toBe(0);
  });

  it("propagates 504 GATEWAY_TIMEOUT when checker times out and isolates state", async () => {
    const repository = new InMemoryTutoringRepository();
    const mastery = new TestMasteryService(0.2);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const timingOutChecker = {
      checkUnderstanding: async () => {
        throw new AppError({
          code: DomainErrorCode.GATEWAY_TIMEOUT,
          statusCode: 504,
          message: "Checker provider timed out",
        });
      },
    };

    const service = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "Checking answer...",
          understandingDetected: true,
        }),
      },
      understandingChecker: timingOutChecker,
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1]
    );

    await repository.insertMessage(actor, {
      id: "00000000-0000-4000-8000-000000000040",
      sessionId,
      role: "assistant",
      content: "Prior question",
      conceptId: FIXTURE_CONCEPT_1,
      understandingDetected: false,
      createdAt: "2026-10-21T12:00:00.000Z",
    });

    await expect(
      service.submitTutoringMessage(actor, sessionId, "Student response", FIXTURE_CONCEPT_1)
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(504);
      expect((err as AppError).code).toBe(DomainErrorCode.GATEWAY_TIMEOUT);
      return true;
    });

    const messages = await repository.listMessages(actor, sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe("user");
    expect(mastery.state.confidence).toBe(0.2);
    expect(mastery.seenEvidenceKeys.size).toBe(0);
  });

  // Check 6: Commit-before-credit & Recovery
  it("fails assistant insertion before mastery credit and leaves mastery untouched", async () => {
    const repository = new InMemoryTutoringRepository();
    const mastery = new TestMasteryService(0.2);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const originalInsert = repository.insertMessage.bind(repository);
    let insertCount = 0;
    repository.insertMessage = async (a, msg) => {
      insertCount++;
      if (msg.role === "assistant" && insertCount > 1) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Database write error on assistant insert",
        });
      }
      return originalInsert(a, msg);
    };

    const service = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "Great explanation!",
          understandingDetected: true,
        }),
      },
      understandingChecker: {
        checkUnderstanding: async () => ({
          understandingConfirmed: true,
          rationale: "Valid explanation",
        }),
      },
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1]
    );

    await repository.insertMessage(actor, {
      id: "00000000-0000-4000-8000-000000000050",
      sessionId,
      role: "assistant",
      content: "Prior question",
      conceptId: FIXTURE_CONCEPT_1,
      understandingDetected: false,
      createdAt: "2026-10-21T12:00:00.000Z",
    });

    await expect(
      service.submitTutoringMessage(actor, sessionId, "Explanation", FIXTURE_CONCEPT_1)
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(500);
      return true;
    });

    expect(mastery.state.confidence).toBe(0.2);
    expect(mastery.seenEvidenceKeys.size).toBe(0);
  });

  it("persists assistant message on mastery failure allowing recovery and idempotent replay", async () => {
    const repository = new InMemoryTutoringRepository();
    const failingMastery = {
      applyEvidence: vi.fn().mockRejectedValue(
        new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Transient database failure",
        })
      ),
    };
    const workingMastery = new TestMasteryService(0.2);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const serviceWithFailingMastery = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "Great breakthrough!",
          understandingDetected: true,
        }),
      },
      understandingChecker: {
        checkUnderstanding: async () => ({
          understandingConfirmed: true,
          rationale: "Confirmed",
        }),
      },
      mastery: failingMastery,
      ids,
      clock,
    });

    const { sessionId } = await serviceWithFailingMastery.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_1]
    );

    await repository.insertMessage(actor, {
      id: "00000000-0000-4000-8000-000000000060",
      sessionId,
      role: "assistant",
      content: "Prior question",
      conceptId: FIXTURE_CONCEPT_1,
      understandingDetected: false,
      createdAt: "2026-10-21T12:00:00.000Z",
    });

    await expect(
      serviceWithFailingMastery.submitTutoringMessage(
        actor,
        sessionId,
        "Clear mechanism",
        FIXTURE_CONCEPT_1
      )
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(500);
      return true;
    });

    // Assistant message is stored with understandingDetected = true
    const messages = await repository.listMessages(actor, sessionId);
    const assistantMsg = messages[messages.length - 1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.understandingDetected).toBe(true);

    // Recover using service with working mastery
    const recoveryService = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "Unused",
          understandingDetected: false,
        }),
      },
      understandingChecker: {
        checkUnderstanding: async () => ({
          understandingConfirmed: false,
          rationale: "Unused",
        }),
      },
      mastery: workingMastery,
      ids,
      clock,
    });

    const recovery = await recoveryService.applyUnderstandingEvidence(
      actor,
      sessionId,
      assistantMsg.id
    );
    expect(recovery.confidence).toBe(0.4);
    expect(recovery.band).toBe("yellow");
    expect(workingMastery.state.confidence).toBe(0.4);
    expect(workingMastery.state.version).toBe(2);
    expect(workingMastery.seenEvidenceKeys.size).toBe(1);

    // Replay on fresh service: idempotent, no extra boost or version bump
    const replayService = new TutoringService({
      repository,
      ai: {
        socraticTutorTurn: async () => ({
          assistantResponse: "Unused",
          understandingDetected: false,
        }),
      },
      understandingChecker: {
        checkUnderstanding: async () => ({
          understandingConfirmed: false,
          rationale: "Unused",
        }),
      },
      mastery: workingMastery,
      ids: new SequentialIdGenerator(),
      clock: new FrozenClock(),
    });

    const replay = await replayService.applyUnderstandingEvidence(
      actor,
      sessionId,
      assistantMsg.id
    );
    expect(replay.confidence).toBe(0.4);
    expect(workingMastery.state.confidence).toBe(0.4);
    expect(workingMastery.state.version).toBe(2);
    expect(workingMastery.seenEvidenceKeys.size).toBe(1);
  });

  // Check 7: Clamping
  it("clamps mastery confidence at 1.00/green on breakthrough from 0.90", async () => {
    const repository = setupDerivativesRepository();
    const mastery = new TestMasteryService(0.9);
    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const ai = new SocraticTutorAi(client);
    const understandingChecker = new CheckUnderstandingAi(client);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const service = new TutoringService({
      repository,
      ai,
      understandingChecker,
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_DERIVATIVES]
    );

    await service.submitTutoringMessage(actor, sessionId, "I am unsure");

    const response = await service.submitTutoringMessage(
      actor,
      sessionId,
      "A derivative is the instantaneous rate of change: the limit of the difference quotient as the input change approaches zero."
    );

    expect(response.understandingDetected).toBe(true);
    expect(response.masteryUpdated).toEqual({
      confidence: 1.0,
      band: "green",
    });
    expect(mastery.state.confidence).toBe(1.0);
    expect(mastery.state.band).toBe("green");
    expect(mastery.state.attempts).toBe(1);
  });

  // Check 8: Socratic/no-key surface
  it("keeps state unconfirmed and provides questioning when student asks for the answer", async () => {
    const repository = setupDerivativesRepository();
    const mastery = new TestMasteryService(0.2);
    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const ai = new SocraticTutorAi(client);
    const understandingChecker = new CheckUnderstandingAi(client);
    const ids = new SequentialIdGenerator();
    const clock = new FrozenClock();
    const actor = createStudentActor();

    const service = new TutoringService({
      repository,
      ai,
      understandingChecker,
      mastery,
      ids,
      clock,
    });

    const { sessionId } = await service.createTutoringSession(
      actor,
      FIXTURE_STUDENT_ID,
      [FIXTURE_CONCEPT_DERIVATIVES]
    );

    const response = await service.submitTutoringMessage(
      actor,
      sessionId,
      "Just give me the answer: what is a derivative?"
    );

    expect(response.understandingDetected).toBe(false);
    expect(response.masteryUpdated).toBeUndefined();
    // Assistant response guides Socratically with a question
    expect(response.assistantContent).toContain("?");
    expect(mastery.state.confidence).toBe(0.2);
    expect(mastery.seenEvidenceKeys.size).toBe(0);
  });
});
