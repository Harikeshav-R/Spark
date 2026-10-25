import { describe, it, expect, beforeAll, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  type ActorContext,
  type ISOTimestamp,
  type UUID,
} from "../../../src/contracts/common.js";
import { AppError } from "../../../src/contracts/errors.js";
import {
  type StudyGroupCandidate,
  type PartyQuestItem,
} from "../../../src/contracts/classroom.js";
import { apiErrorHandler } from "../../../src/server/platform/index.js";
import {
  InvitationsService,
  PartyQuestService,
  createStudyGroupRouter,
  findComplementaryCandidates,
  type MatchProfile,
} from "../../../src/server/study-groups/index.js";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../lane-a/supabase-harness.js";
import { runPsql } from "../lane-a/postgres-test-helpers.js";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service.js";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository.js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator.js";

class FixedClock {
  private currentTime: Date;
  constructor(initial: Date = new Date("2026-10-24T12:00:00.000Z")) {
    this.currentTime = initial;
  }
  now(): Date {
    return new Date(this.currentTime);
  }
  nowISO(): ISOTimestamp {
    return this.currentTime.toISOString();
  }
  advance(ms: number) {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

class SequentialIdGen {
  private count = 0;
  generateId(): UUID {
    this.count++;
    const hex = this.count.toString(16).padStart(12, "0");
    return `99999999-9999-4999-8999-${hex}` as UUID;
  }
}

describe("P6-B-05: Collaborative Party Quests, Candidate Invitations & Reward Distribution", () => {
  const courseId = "11111111-1111-4111-8111-111111111111" as UUID;
  const student1Id = "22222222-2222-4222-8222-222222222221" as UUID;
  const student2Id = "22222222-2222-4222-8222-222222222222" as UUID;
  const student3Id = "22222222-2222-4222-8222-222222222223" as UUID;
  const concept1 = "33333333-3333-4333-8333-333333333301" as UUID;
  const concept2 = "33333333-3333-4333-8333-333333333302" as UUID;
  const matchId = "44444444-4444-4444-8444-444444444444" as UUID;

  const student1Actor: ActorContext = {
    userId: "55555555-5555-4555-8555-555555555551" as UUID,
    authId: "55555555-5555-4555-8555-555555555551" as UUID,
    role: "student",
    email: "student1@example.test",
    name: "Student One",
    enrolledCourses: [{ studentId: student1Id, courseId }],
  };

  const student2Actor: ActorContext = {
    userId: "55555555-5555-4555-8555-555555555552" as UUID,
    authId: "55555555-5555-4555-8555-555555555552" as UUID,
    role: "student",
    email: "student2@example.test",
    name: "Student Two",
    enrolledCourses: [{ studentId: student2Id, courseId }],
  };

  const teacherActor: ActorContext = {
    userId: "55555555-5555-4555-8555-555555555550" as UUID,
    authId: "55555555-5555-4555-8555-555555555550" as UUID,
    role: "teacher",
    email: "teacher@example.test",
    name: "Prof. Teacher",
    enrolledCourses: [],
  };

  describe("1. Candidate Fit & Knowledge Gap Invariants (Offline)", () => {
    it("computes reciprocal fit, exact unrounded gap 0.65, and display fit 65 for complementary concepts", () => {
      const now = new Date("2026-10-24T12:00:00.000Z");
      const requester = {
        id: "pool-1" as UUID,
        studentId: student1Id,
        courseId,
        conceptIds: [concept1, concept2],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      const candidate = {
        id: "pool-2" as UUID,
        studentId: student2Id,
        courseId,
        conceptIds: [concept1, concept2],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      // Student 1 has [0.80, 0.15], Student 2 has [0.15, 0.80]
      const profiles = new Map<UUID, MatchProfile>([
        [
          student1Id,
          {
            studentId: student1Id,
            name: "Student One",
            confidences: new Map([
              [concept1, 0.8],
              [concept2, 0.15],
            ]),
          },
        ],
        [
          student2Id,
          {
            studentId: student2Id,
            name: "Student Two",
            confidences: new Map([
              [concept1, 0.15],
              [concept2, 0.8],
            ]),
          },
        ],
      ]);

      const candidates = findComplementaryCandidates(
        requester,
        [candidate],
        profiles,
        now,
      );

      expect(candidates).toHaveLength(1);
      const c = candidates[0];
      // Total diff = |0.80 - 0.15| + |0.15 - 0.80| = 0.65 + 0.65 = 1.30. Gap = 1.30 / 2 = 0.65
      expect(c.gap).toBeCloseTo(0.65, 5);
      const displayFit = Math.min(99, Math.round(100 * c.gap));
      expect(displayFit).toBe(65);

      // Verify reciprocal vs mentor classification
      const requesterProfile = profiles.get(student1Id)!;
      const candidateProfile = profiles.get(student2Id)!;
      let rHigher = false;
      let cHigher = false;
      for (const cid of c.conceptIds) {
        if (
          requesterProfile.confidences.get(cid)! >
          candidateProfile.confidences.get(cid)!
        )
          rHigher = true;
        if (
          candidateProfile.confidences.get(cid)! >
          requesterProfile.confidences.get(cid)!
        )
          cHigher = true;
      }
      expect(rHigher && cHigher).toBe(true); // Reciprocal!
    });

    it("classifies single-direction strength as mentor fit", () => {
      const now = new Date("2026-10-24T12:00:00.000Z");
      const requester = {
        id: "pool-1" as UUID,
        studentId: student1Id,
        courseId,
        conceptIds: [concept1],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      const candidate = {
        id: "pool-2" as UUID,
        studentId: student2Id,
        courseId,
        conceptIds: [concept1],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      // Student 1 has [0.80], Student 2 has [0.15]
      const profiles = new Map<UUID, MatchProfile>([
        [
          student1Id,
          {
            studentId: student1Id,
            name: "Student One",
            confidences: new Map([[concept1, 0.8]]),
          },
        ],
        [
          student2Id,
          {
            studentId: student2Id,
            name: "Student Two",
            confidences: new Map([[concept1, 0.15]]),
          },
        ],
      ]);

      const candidates = findComplementaryCandidates(
        requester,
        [candidate],
        profiles,
        now,
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].gap).toBeCloseTo(0.65, 5);

      const requesterProfile = profiles.get(student1Id)!;
      const candidateProfile = profiles.get(student2Id)!;
      let rHigher = false;
      let cHigher = false;
      for (const cid of candidates[0].conceptIds) {
        if (
          requesterProfile.confidences.get(cid)! >
          candidateProfile.confidences.get(cid)!
        )
          rHigher = true;
        if (
          candidateProfile.confidences.get(cid)! >
          requesterProfile.confidences.get(cid)!
        )
          cHigher = true;
      }
      expect(rHigher && cHigher).toBe(false); // Mentor fit, not reciprocal!
    });

    it("boundary threshold: 0.30 qualifies, 0.299 is excluded", () => {
      const now = new Date("2026-10-24T12:00:00.000Z");
      const requester = {
        id: "pool-1" as UUID,
        studentId: student1Id,
        courseId,
        conceptIds: [concept1],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      const candidateA = {
        id: "pool-2" as UUID,
        studentId: student2Id,
        courseId,
        conceptIds: [concept1],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      const candidateB = {
        id: "pool-3" as UUID,
        studentId: student3Id,
        courseId,
        conceptIds: [concept1],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      const profiles = new Map<UUID, MatchProfile>([
        [
          student1Id,
          {
            studentId: student1Id,
            name: "Student One",
            confidences: new Map([[concept1, 0.5]]),
          },
        ],
        [
          student2Id,
          {
            studentId: student2Id,
            name: "Student Two",
            confidences: new Map([[concept1, 0.8]]),
          },
        ], // gap = 0.300
        [
          student3Id,
          {
            studentId: student3Id,
            name: "Student Three",
            confidences: new Map([[concept1, 0.799]]),
          },
        ], // gap = 0.299
      ]);

      const candidates = findComplementaryCandidates(
        requester,
        [candidateA, candidateB],
        profiles,
        now,
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].entry.studentId).toBe(student2Id);
    });

    it("omits pairing when mastery is missing; throws on invalid present confidence", () => {
      const now = new Date("2026-10-24T12:00:00.000Z");
      const requester = {
        id: "pool-1" as UUID,
        studentId: student1Id,
        courseId,
        conceptIds: [concept1],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      const candidate = {
        id: "pool-2" as UUID,
        studentId: student2Id,
        courseId,
        conceptIds: [concept1],
        status: "waiting" as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      };

      // Candidate lacks mastery on concept1
      const missingProfiles = new Map<UUID, MatchProfile>([
        [
          student1Id,
          {
            studentId: student1Id,
            name: "Student One",
            confidences: new Map([[concept1, 0.8]]),
          },
        ],
        [
          student2Id,
          {
            studentId: student2Id,
            name: "Student Two",
            confidences: new Map(),
          },
        ],
      ]);

      const missingCandidates = findComplementaryCandidates(
        requester,
        [candidate],
        missingProfiles,
        now,
      );
      expect(missingCandidates).toHaveLength(0); // omitted

      // Invalid present confidence throws INTERNAL_SERVER_ERROR
      const invalidProfiles = new Map<UUID, MatchProfile>([
        [
          student1Id,
          {
            studentId: student1Id,
            name: "Student One",
            confidences: new Map([[concept1, 1.5]]),
          },
        ],
        [
          student2Id,
          {
            studentId: student2Id,
            name: "Student Two",
            confidences: new Map([[concept1, 0.2]]),
          },
        ],
      ]);

      expect(() =>
        findComplementaryCandidates(
          requester,
          [candidate],
          invalidProfiles,
          now,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
        }),
      );
    });
  });

  describe("2. Invitations Service & Lifecycle Scenarios (Offline)", () => {
    let clock: FixedClock;
    let idGen: SequentialIdGen;
    let mockCourses: { getCourse: Mock };
    let mockPool: {
      getEntryByStudent: Mock;
      getActiveEntries: Mock;
    };
    let mockMatches: {
      getCourseConceptIds: Mock;
      getProfiles: Mock;
    };
    let mockInvitationsRepo: {
      createInvitation: Mock;
      respondToInvitation: Mock;
      getConceptLabels: Mock;
      getInvitationById: Mock;
    };
    let mockPublisher: { emitToStudent: Mock };
    let service: InvitationsService;

    beforeAll(() => {
      clock = new FixedClock();
      idGen = new SequentialIdGen();
      mockCourses = { getCourse: vi.fn().mockResolvedValue({}) };
      mockPool = {
        getEntryByStudent: vi.fn(),
        getActiveEntries: vi.fn(),
      };
      mockMatches = {
        getCourseConceptIds: vi.fn(),
        getProfiles: vi.fn(),
      };
      mockInvitationsRepo = {
        createInvitation: vi.fn(),
        respondToInvitation: vi.fn(),
        getConceptLabels: vi.fn(),
        getInvitationById: vi.fn(),
      };
      mockPublisher = { emitToStudent: vi.fn().mockResolvedValue(undefined) };

      service = new InvitationsService({
        courses: mockCourses,
        pool: mockPool,
        matches: mockMatches,
        invitations: mockInvitationsRepo,
        publisher: mockPublisher,
        clock,
        ids: idGen,
      });
    });

    it("rejects unauthorized actors, self-invites, and duplicate concepts", async () => {
      // Non-student actor
      await expect(
        service.getCandidates(teacherActor, courseId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      // Self-invitation
      await expect(
        service.sendInvitation(student1Actor, courseId, student1Id, [concept1]),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Duplicate concepts
      await expect(
        service.sendInvitation(student1Actor, courseId, student2Id, [
          concept1,
          concept1,
        ]),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("ties invitation expiration to the earlier pool expiry timestamp", async () => {
      const now = clock.now();
      const expiry1 = new Date(now.getTime() + 100000).toISOString();
      const expiry2 = new Date(now.getTime() + 200000).toISOString();

      mockPool.getEntryByStudent
        .mockResolvedValueOnce({
          id: "pool-1",
          studentId: student1Id,
          courseId,
          conceptIds: [concept1],
          status: "waiting",
          createdAt: now.toISOString(),
          expiresAt: expiry1, // Earlier expiry!
        })
        .mockResolvedValueOnce({
          id: "pool-2",
          studentId: student2Id,
          courseId,
          conceptIds: [concept1],
          status: "waiting",
          createdAt: now.toISOString(),
          expiresAt: expiry2,
        });

      mockMatches.getCourseConceptIds.mockResolvedValueOnce([concept1]);
      mockMatches.getProfiles.mockResolvedValueOnce(
        new Map([
          [
            student1Id,
            {
              studentId: student1Id,
              name: "Student 1",
              confidences: new Map([[concept1, 0.8]]),
            },
          ],
          [
            student2Id,
            {
              studentId: student2Id,
              name: "Student 2",
              confidences: new Map([[concept1, 0.2]]),
            },
          ],
        ]),
      );

      mockInvitationsRepo.createInvitation.mockResolvedValueOnce({
        invitationId: "inv-1" as UUID,
        expiresAt: expiry1,
      });

      const res = await service.sendInvitation(
        student1Actor,
        courseId,
        student2Id,
        [concept1],
      );

      expect(res.expiresAt).toBe(expiry1);
      expect(mockInvitationsRepo.createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expiry1,
        }),
      );
    });

    it("throws 409 INVITATION_EXPIRED when invitation has expired", async () => {
      mockInvitationsRepo.respondToInvitation.mockResolvedValueOnce({
        status: "expired",
        changed: true,
      });

      await expect(
        service.respondToInvitation(
          student2Actor,
          "88888888-8888-4888-8888-888888888801" as UUID,
          "accepted",
        ),
      ).rejects.toMatchObject({
        code: "INVITATION_EXPIRED",
        statusCode: 409,
      });
    });

    it("accepting invitation emits study-group:matched events to both peers", async () => {
      const invId = "88888888-8888-4888-8888-888888888802" as UUID;
      mockInvitationsRepo.respondToInvitation.mockResolvedValueOnce({
        status: "accepted",
        matchId,
        changed: true,
      });

      mockInvitationsRepo.getInvitationById.mockResolvedValueOnce({
        id: invId,
        course_id: courseId,
        inviter_student_id: student1Id,
        invitee_student_id: student2Id,
        concept_ids: [concept1],
        status: "accepted",
        resulting_match_id: matchId,
      });

      mockMatches.getProfiles.mockResolvedValueOnce(
        new Map([
          [
            student1Id,
            {
              studentId: student1Id,
              name: "Student 1",
              confidences: new Map([[concept1, 0.8]]),
            },
          ],
          [
            student2Id,
            {
              studentId: student2Id,
              name: "Student 2",
              confidences: new Map([[concept1, 0.2]]),
            },
          ],
        ]),
      );

      const res = await service.respondToInvitation(
        student2Actor,
        invId,
        "accepted",
      );

      expect(res.status).toBe("accepted");
      expect(res.matchId).toBe(matchId);
      expect(mockPublisher.emitToStudent).toHaveBeenCalledTimes(2);
      expect(mockPublisher.emitToStudent).toHaveBeenCalledWith(
        student1Id,
        "study-group:matched",
        expect.objectContaining({
          matchId,
          peerName: "Student 2",
        }),
      );
      expect(mockPublisher.emitToStudent).toHaveBeenCalledWith(
        student2Id,
        "study-group:matched",
        expect.objectContaining({
          matchId,
          peerName: "Student 1",
        }),
      );
    });

    it("replay of already accepted invitation does not re-emit socket events", async () => {
      mockPublisher.emitToStudent.mockClear();
      mockInvitationsRepo.respondToInvitation.mockResolvedValueOnce({
        status: "accepted",
        matchId,
        changed: false, // replay!
      });

      const res = await service.respondToInvitation(
        student2Actor,
        "88888888-8888-4888-8888-888888888803" as UUID,
        "accepted",
      );

      expect(res.status).toBe("accepted");
      expect(res.matchId).toBe(matchId);
      expect(mockPublisher.emitToStudent).not.toHaveBeenCalled();
    });
  });

  describe("3. Party Quests & Bilateral Rewards Lifecycle (Offline)", () => {
    let clock: FixedClock;
    let idGen: SequentialIdGen;
    let mockMembership: { requireMatchMember: Mock };
    let mockQuestsRepo: {
      createPartyQuest: Mock;
      getMatchById: Mock;
      getQuestsForMatch: Mock;
      getProgressForQuest: Mock;
      getQuestWithMatch: Mock;
      recordPartyProgressRpc: Mock;
    };
    let mockPublisher: { emitToStudyGroup: Mock };
    let partyService: PartyQuestService;

    beforeAll(() => {
      clock = new FixedClock();
      idGen = new SequentialIdGen();
      mockMembership = { requireMatchMember: vi.fn().mockResolvedValue({}) };
      mockQuestsRepo = {
        createPartyQuest: vi.fn(),
        getMatchById: vi.fn(),
        getQuestsForMatch: vi.fn(),
        getProgressForQuest: vi.fn(),
        getQuestWithMatch: vi.fn(),
        recordPartyProgressRpc: vi.fn(),
      };
      mockPublisher = { emitToStudyGroup: vi.fn().mockResolvedValue(undefined) };

      partyService = new PartyQuestService({
        questsRepo: mockQuestsRepo,
        membership: mockMembership,
        publisher: mockPublisher,
        clock,
        ids: idGen,
      });
    });

    it("rejects quest creation with concepts outside the match", async () => {
      mockQuestsRepo.getMatchById.mockResolvedValueOnce({
        id: matchId,
        course_id: courseId,
        student1_id: student1Id,
        student2_id: student2Id,
        concept_ids: [concept1], // only concept1
        status: "active",
      });

      await expect(
        partyService.createPartyQuest(student1Actor, matchId, [
          concept1,
          concept2,
        ]),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("creates party quest, publishes event with 0 completed pairs, and derives full progress matrix on get", async () => {
      const partyQuestId = "pq-1" as UUID;
      mockQuestsRepo.getMatchById.mockResolvedValue({
        id: matchId,
        course_id: courseId,
        student1_id: student1Id,
        student2_id: student2Id,
        concept_ids: [concept1, concept2],
        status: "active",
      });

      mockQuestsRepo.createPartyQuest.mockResolvedValueOnce({
        partyQuestId,
        status: "active",
        conceptIds: [concept1, concept2],
      });

      const quest = await partyService.createPartyQuest(
        student1Actor,
        matchId,
        [concept1, concept2],
      );

      expect(quest.partyQuestId).toBe(partyQuestId);
      expect(quest.status).toBe("active");
      expect(mockPublisher.emitToStudyGroup).toHaveBeenCalledWith(
        matchId,
        "party:quest-updated",
        expect.objectContaining({
          partyQuestId,
          version: 1,
          status: "active",
          completedPairs: 0,
          totalPairs: 4,
        }),
      );

      // getPartyQuests derives all 4 student/concept pairs
      mockQuestsRepo.getQuestsForMatch.mockResolvedValueOnce([
        {
          id: partyQuestId,
          match_id: matchId,
          concept_ids: [concept1, concept2],
          status: "active",
          version: 1,
          created_at: clock.nowISO(),
          updated_at: clock.nowISO(),
          completed_at: null,
        },
      ]);

      mockQuestsRepo.getProgressForQuest.mockResolvedValueOnce([
        // student1 has completed concept1 only
        {
          party_quest_id: partyQuestId,
          student_id: student1Id,
          concept_id: concept1,
          quiz_attempt_id: "att-1" as UUID,
          completed_at: clock.nowISO(),
        },
      ]);

      const quests = await partyService.getPartyQuests(student1Actor, matchId);
      expect(quests).toHaveLength(1);
      const q = quests[0];
      expect(q.progress).toHaveLength(4);
      // Student 1 concept 1 is complete
      const s1c1 = q.progress.find(
        (p) => p.studentId === student1Id && p.conceptId === concept1,
      );
      expect(s1c1?.completed).toBe(true);
      // Student 1 concept 2 is incomplete
      const s1c2 = q.progress.find(
        (p) => p.studentId === student1Id && p.conceptId === concept2,
      );
      expect(s1c2?.completed).toBe(false);
      // Student 2 concept 1 is incomplete
      const s2c1 = q.progress.find(
        (p) => p.studentId === student2Id && p.conceptId === concept1,
      );
      expect(s2c1?.completed).toBe(false);
    });

    it("authorizes party encounters and rejects invalid attempts or non-quest concepts", async () => {
      mockQuestsRepo.getQuestWithMatch.mockResolvedValueOnce({
        quest: {
          id: "pq-1" as UUID,
          match_id: matchId,
          concept_ids: [concept1],
          status: "active",
        },
        match: {
          id: matchId,
          course_id: courseId,
          student1_id: student1Id,
          student2_id: student2Id,
        },
      });

      // Valid encounter authorization succeeds
      await expect(
        partyService.authorizePartyEncounter(
          student1Actor,
          courseId,
          student1Id,
          "pq-1" as UUID,
          concept1,
        ),
      ).resolves.toBeUndefined();

      // Non-member student rejected with 403
      mockQuestsRepo.getQuestWithMatch.mockResolvedValueOnce({
        quest: {
          id: "pq-1" as UUID,
          match_id: matchId,
          concept_ids: [concept1],
          status: "active",
        },
        match: {
          id: matchId,
          course_id: courseId,
          student1_id: student1Id,
          student2_id: student2Id,
        },
      });

      const otherStudentActor: ActorContext = {
        ...student1Actor,
        enrolledCourses: [{ studentId: student3Id, courseId }],
      };

      await expect(
        partyService.authorizePartyEncounter(
          otherStudentActor,
          courseId,
          student3Id,
          "pq-1" as UUID,
          concept1,
        ),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("emits party:quest-updated only when progress RPC changed is true", async () => {
      mockPublisher.emitToStudyGroup.mockClear();

      mockQuestsRepo.recordPartyProgressRpc.mockResolvedValueOnce({
        partyQuestId: "pq-1" as UUID,
        matchId,
        status: "completed",
        version: 5,
        completedPairs: 4,
        totalPairs: 4,
        occurredAt: clock.nowISO(),
        changed: true,
      });

      await partyService.recordPartyEncounterCompletion(
        student1Actor,
        "pq-1" as UUID,
        "attempt-1" as UUID,
      );

      expect(mockPublisher.emitToStudyGroup).toHaveBeenCalledTimes(1);
      expect(mockPublisher.emitToStudyGroup).toHaveBeenCalledWith(
        matchId,
        "party:quest-updated",
        expect.objectContaining({
          status: "completed",
          completedPairs: 4,
          totalPairs: 4,
          version: 5,
        }),
      );

      // Replay: changed is false -> no emission
      mockPublisher.emitToStudyGroup.mockClear();
      mockQuestsRepo.recordPartyProgressRpc.mockResolvedValueOnce({
        partyQuestId: "pq-1" as UUID,
        matchId,
        status: "completed",
        version: 5,
        completedPairs: 4,
        totalPairs: 4,
        occurredAt: clock.nowISO(),
        changed: false,
      });

      await partyService.recordPartyEncounterCompletion(
        student1Actor,
        "pq-1" as UUID,
        "attempt-1" as UUID,
      );

      expect(mockPublisher.emitToStudyGroup).not.toHaveBeenCalled();
    });
  });

  describe("4. HTTP Router Endpoints (Offline)", () => {
    let app: express.Express;
    let mockAuth: { verifyToken: Mock };
    let mockInvitations: {
      getCandidates: Mock;
      sendInvitation: Mock;
      respondToInvitation: Mock;
    };
    let mockPartyQuests: {
      createPartyQuest: Mock;
      getPartyQuests: Mock;
    };

    beforeAll(() => {
      app = express();
      app.use(express.json());

      mockAuth = {
        verifyToken: vi.fn().mockImplementation(async (token: string) => {
          if (token === "student-token") return student1Actor;
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Invalid token",
          });
        }),
      };

      mockInvitations = {
        getCandidates: vi.fn().mockResolvedValue([
          {
            studentId: student2Id,
            requestedConcepts: [
              { conceptId: concept1, label: "Concept 1", band: "green" },
            ],
            complementaryGap: 0.65,
            fitKind: "reciprocal",
          },
        ]),
        sendInvitation: vi.fn().mockResolvedValue({
          invitationId: "inv-created-id" as UUID,
          expiresAt: "2026-10-24T12:05:00.000Z",
        }),
        respondToInvitation: vi.fn().mockResolvedValue({
          status: "accepted",
          matchId,
        }),
      };

      mockPartyQuests = {
        createPartyQuest: vi.fn().mockResolvedValue({
          partyQuestId: "pq-created-id" as UUID,
          status: "active",
          conceptIds: [concept1],
        }),
        getPartyQuests: vi.fn().mockResolvedValue([
          {
            partyQuestId: "pq-created-id" as UUID,
            conceptIds: [concept1],
            status: "active",
            progress: [],
          },
        ]),
      };

      const router = createStudyGroupRouter({
        auth: mockAuth,
        studyGroups: {
          optIntoPool: vi.fn(),
          optOutOfPool: vi.fn(),
        },
        messaging: {
          getMatchMessages: vi.fn(),
          sendMessage: vi.fn(),
        },
        membership: {
          requireMatchMember: vi.fn(),
        },
        scheduler: {
          proposeSchedule: vi.fn(),
          acceptSchedule: vi.fn(),
        },
        schedulerRepository: {
          getMatch: vi.fn(),
        },
        availability: {
          registerAvailability: vi.fn(),
          getAvailability: vi.fn(),
        },
        invitations: mockInvitations,
        partyQuests: mockPartyQuests,
      });

      app.use(router);
      app.use(apiErrorHandler);
    });

    it("GET /api/courses/:courseId/study-groups/candidates returns 200 with candidates envelope", async () => {
      const server = http.createServer(app);
      const { promise, resolve } = Promise.withResolvers<void>();
      server.listen(0, () => resolve());
      await promise;
      const port = (server.address() as AddressInfo).port;

      const res = await fetch(
        `http://127.0.0.1:${port}/api/courses/${courseId}/study-groups/candidates`,
        {
          headers: { Authorization: "Bearer student-token" },
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { candidates: StudyGroupCandidate[] };
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0].studentId).toBe(student2Id);
      server.close();
    });

    it("POST /api/courses/:courseId/study-groups/invitations returns 201 with invitation envelope", async () => {
      const server = http.createServer(app);
      const { promise, resolve } = Promise.withResolvers<void>();
      server.listen(0, () => resolve());
      await promise;
      const port = (server.address() as AddressInfo).port;

      const res = await fetch(
        `http://127.0.0.1:${port}/api/courses/${courseId}/study-groups/invitations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer student-token",
          },
          body: JSON.stringify({
            inviteeId: student2Id,
            conceptIds: [concept1],
          }),
        },
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        invitationId: string;
        status: string;
      };
      expect(body.invitationId).toBe("inv-created-id");
      expect(body.status).toBe("pending");
      server.close();
    });

    it("POST /api/study-group-invitations/:invitationId/respond returns 200 with decision outcome", async () => {
      const server = http.createServer(app);
      const { promise, resolve } = Promise.withResolvers<void>();
      server.listen(0, () => resolve());
      await promise;
      const port = (server.address() as AddressInfo).port;

      const res = await fetch(
        `http://127.0.0.1:${port}/api/study-group-invitations/88888888-8888-4888-8888-888888888804/respond`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer student-token",
          },
          body: JSON.stringify({
            decision: "accepted",
          }),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; matchId?: string };
      expect(body.status).toBe("accepted");
      expect(body.matchId).toBe(matchId);
      server.close();
    });

    it("POST and GET /api/study-groups/:matchId/quests handle quest lifecycle", async () => {
      const server = http.createServer(app);
      const { promise, resolve } = Promise.withResolvers<void>();
      server.listen(0, () => resolve());
      await promise;
      const port = (server.address() as AddressInfo).port;

      // POST create quest
      const postRes = await fetch(
        `http://127.0.0.1:${port}/api/study-groups/${matchId}/quests`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer student-token",
          },
          body: JSON.stringify({
            conceptIds: [concept1],
          }),
        },
      );

      expect(postRes.status).toBe(201);
      const postBody = (await postRes.json()) as {
        partyQuestId: string;
        status: string;
      };
      expect(postBody.partyQuestId).toBe("pq-created-id");
      expect(postBody.status).toBe("active");

      // GET quests
      const getRes = await fetch(
        `http://127.0.0.1:${port}/api/study-groups/${matchId}/quests`,
        {
          headers: { Authorization: "Bearer student-token" },
        },
      );

      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as {
        partyQuests: PartyQuestItem[];
      };
      expect(getBody.partyQuests).toHaveLength(1);
      expect(getBody.partyQuests[0].partyQuestId).toBe("pq-created-id");
      server.close();
    });
  });

  describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
    "5. Live PostgreSQL Integration Tests (Local Supabase)",
    () => {
      let harness: SupabaseTestHarness;
      let context: TestContext;
      let enrollmentService: EnrollmentService;
      let idGenerator: CryptoIdGenerator;

      beforeAll(() => {
        harness = new SupabaseTestHarness();
        idGenerator = new CryptoIdGenerator();
        enrollmentService = new EnrollmentService(
          new EnrollmentRepository(harness.serviceClient),
        );
      });

      afterEach(async () => {
        if (context) {
          await harness.cleanup(context);
        }
      });

      it("executes complete live database flow: candidate discovery, invitation acceptance, party quest 4-pair completion, and bilateral 60 XP awards", async () => {
        context = { users: [], teacherIds: [], courseIds: [] };
        const course = await harness.createTestCourse(context, {
          conceptCount: 2,
        });
        const c1 = course.conceptIds[0];
        const c2 = course.conceptIds[1];

        const userA = await harness.createTestUser(context, "student", {
          name: "Alice",
        });
        const userB = await harness.createTestUser(context, "student", {
          name: "Bob",
        });

        const studentA = await enrollmentService.enrollStudent(
          harness.buildStudentActor(userA),
          course.joinCode,
        );
        const studentB = await enrollmentService.enrollStudent(
          harness.buildStudentActor(userB),
          course.joinCode,
        );
        const studentAId = studentA.id;
        const studentBId = studentB.id;

        // Seed mastery: Alice has [0.85, 0.15], Bob has [0.15, 0.85] -> reciprocal, gap 0.70
        const { error: masteryErr } = await harness.serviceClient
          .from("student_mastery")
          .upsert(
            [
              {
                student_id: studentAId,
                concept_id: c1,
                confidence: 0.85,
              },
              {
                student_id: studentAId,
                concept_id: c2,
                confidence: 0.15,
              },
              {
                student_id: studentBId,
                concept_id: c1,
                confidence: 0.15,
              },
              {
                student_id: studentBId,
                concept_id: c2,
                confidence: 0.85,
              },
            ],
            { onConflict: "student_id,concept_id" },
          );
        expect(masteryErr).toBeNull();
        // Opt both students into pool
        const expiry = new Date(Date.now() + 300000).toISOString();
        await harness.serviceClient.from("study_group_pool").insert([
          {
            student_id: studentAId,
            course_id: course.courseId,
            concept_ids: [c1, c2],
            status: "waiting",
            expires_at: expiry,
          },
          {
            student_id: studentBId,
            course_id: course.courseId,
            concept_ids: [c1, c2],
            status: "waiting",
            expires_at: expiry,
          },
        ]);

        // Insert pending invitation from Alice to Bob for [c1, c2]
        const { data: invRow, error: invErr } = await harness.serviceClient
          .from("study_group_invitations")
          .insert({
            course_id: course.courseId,
            inviter_student_id: studentAId,
            invitee_student_id: studentBId,
            concept_ids: [c1, c2],
            status: "pending",
            expires_at: expiry,
          })
          .select("id")
          .single();

        expect(invErr).toBeNull();
        const invitationId = invRow!.id;

        // Bob responds with accepted via RPC
        const { data: rpcOutcome, error: rpcErr } =
          await harness.serviceClient.rpc("respond_study_group_invitation", {
            p_actor_auth_id: userB.authId,
            p_invitation_id: invitationId,
            p_decision: "accepted",
          });

        expect(rpcErr).toBeNull();
        expect(rpcOutcome.status).toBe("accepted");
        expect(rpcOutcome.changed).toBe(true);
        expect(rpcOutcome.matchId).toBeDefined();

        const liveMatchId = rpcOutcome.matchId;

        // Replay of acceptance: changed is false, same matchId returned
        const { data: replayOutcome } = await harness.serviceClient.rpc(
          "respond_study_group_invitation",
          {
            p_actor_auth_id: userB.authId,
            p_invitation_id: invitationId,
            p_decision: "accepted",
          },
        );
        expect(replayOutcome.changed).toBe(false);
        expect(replayOutcome.matchId).toBe(liveMatchId);

        // Verify pool entries both transitioned to 'matched'
        const { data: poolRows } = await harness.serviceClient
          .from("study_group_pool")
          .select("status")
          .eq("course_id", course.courseId)
          .in("student_id", [studentAId, studentBId]);
        expect(poolRows).toHaveLength(2);
        expect(poolRows![0].status).toBe("matched");
        expect(poolRows![1].status).toBe("matched");

        // Create 2-concept party quest
        const { data: questRow, error: questErr } = await harness.serviceClient
          .from("party_quests")
          .insert({
            match_id: liveMatchId,
            concept_ids: [c1, c2],
            status: "active",
            version: 1,
          })
          .select("id")
          .single();

        expect(questErr).toBeNull();
        const liveQuestId = questRow!.id;

        // Helper to create completed party encounter and quiz attempt with 5 questions
        const createCompletedAttempt = async (
          studentId: UUID,
          conceptId: UUID,
        ) => {
          const qids = [
            idGenerator.generateId(),
            idGenerator.generateId(),
            idGenerator.generateId(),
            idGenerator.generateId(),
            idGenerator.generateId(),
          ];

          const { data: enc } = await harness.serviceClient
            .from("encounters")
            .insert({
              student_id: studentId,
              concept_id: conceptId,
              source: "party",
              party_quest_id: liveQuestId,
              status: "completed",
              question_ids: qids,
              option_permutations: [
                [0, 1, 2, 3],
                [0, 1, 2, 3],
                [0, 1, 2, 3],
                [0, 1, 2, 3],
                [0, 1, 2, 3],
              ],
            })
            .select("id")
            .single();

          const { data: att } = await harness.serviceClient
            .from("quiz_attempts")
            .insert({
              student_id: studentId,
              concept_id: conceptId,
              score: 1.0,
              correct_count: 5,
              total_questions: 5,
              encounter_id: enc!.id,
              submitted_answers: qids.map((qid) => ({
                question_id: qid,
                selected_option: 0,
                correct: true,
              })),
            })
            .select("id")
            .single();

          const { error: evErr } = await harness.serviceClient
            .from("mastery_evidence")
            .insert({
              student_id: studentId,
              concept_id: conceptId,
              evidence_type: "quiz",
              source_id: att!.id,
              prior_confidence: 0.5,
              new_confidence: 0.6,
            });
          expect(evErr).toBeNull();
          return att!.id;
        };

        // 1. Alice completes concept 1
        const attA1 = await createCompletedAttempt(studentAId, c1);
        const { data: prog1, error: prog1Err } = await harness.serviceClient.rpc(
          "record_party_quest_progress",
          {
            p_actor_auth_id: userA.authId,
            p_party_quest_id: liveQuestId,
            p_attempt_id: attA1,
          },
        );
        expect(prog1Err).toBeNull();
        expect(prog1.completedPairs).toBe(1);
        expect(prog1.status).toBe("active");
        expect(prog1.changed).toBe(true);

        // 2. Alice completes concept 2
        const attA2 = await createCompletedAttempt(studentAId, c2);
        const { data: prog2 } = await harness.serviceClient.rpc(
          "record_party_quest_progress",
          {
            p_actor_auth_id: userA.authId,
            p_party_quest_id: liveQuestId,
            p_attempt_id: attA2,
          },
        );
        expect(prog2.completedPairs).toBe(2);
        expect(prog2.status).toBe("active");

        // Check XP events: zero party rewards yet
        const { data: xpBeforeComplete } = await harness.serviceClient
          .from("xp_events")
          .select("*")
          .eq("source_id", liveQuestId);
        expect(xpBeforeComplete).toHaveLength(0);

        // 3. Bob completes concept 1
        const attB1 = await createCompletedAttempt(studentBId, c1);
        const { data: prog3 } = await harness.serviceClient.rpc(
          "record_party_quest_progress",
          {
            p_actor_auth_id: userB.authId,
            p_party_quest_id: liveQuestId,
            p_attempt_id: attB1,
          },
        );
        expect(prog3.completedPairs).toBe(3);
        expect(prog3.status).toBe("active");

        // 4. Bob completes concept 2 -> QUEST COMPLETION!
        const attB2 = await createCompletedAttempt(studentBId, c2);
        const { data: prog4 } = await harness.serviceClient.rpc(
          "record_party_quest_progress",
          {
            p_actor_auth_id: userB.authId,
            p_party_quest_id: liveQuestId,
            p_attempt_id: attB2,
          },
        );
        expect(prog4.completedPairs).toBe(4);
        expect(prog4.status).toBe("completed");
        expect(prog4.changed).toBe(true);

        // Verify both peers received 60 XP
        const { data: xpRows } = await harness.serviceClient
          .from("xp_events")
          .select("*")
          .eq("source_id", liveQuestId)
          .eq("reason", "party");

        expect(xpRows).toHaveLength(2);
        const studentA_Xp = xpRows!.find(
          (x) => x.student_id === studentAId,
        );
        const studentB_Xp = xpRows!.find(
          (x) => x.student_id === studentBId,
        );
        expect(studentA_Xp?.amount).toBe(60);
        expect(studentB_Xp?.amount).toBe(60);

        // Duplicate replay of the final attempt: changed is false, no extra XP rows
        const { data: progReplay } = await harness.serviceClient.rpc(
          "record_party_quest_progress",
          {
            p_actor_auth_id: userB.authId,
            p_party_quest_id: liveQuestId,
            p_attempt_id: attB2,
          },
        );
        expect(progReplay.changed).toBe(false);
        expect(progReplay.status).toBe("completed");

        const { count: xpCount } = await harness.serviceClient
          .from("xp_events")
          .select("*", { count: "exact", head: true })
          .eq("source_id", liveQuestId);
        expect(xpCount).toBe(2);
      });

      it("atomic rollback: failure on reward insertion rolls back progress and status", async () => {
        context = { users: [], teacherIds: [], courseIds: [] };
        const course = await harness.createTestCourse(context, {
          conceptCount: 1,
        });
        const c1 = course.conceptIds[0];

        const userA = await harness.createTestUser(context, "student", {
          name: "Alice",
        });
        const userB = await harness.createTestUser(context, "student", {
          name: "Bob",
        });

        const studentA = await enrollmentService.enrollStudent(
          harness.buildStudentActor(userA),
          course.joinCode,
        );
        const studentB = await enrollmentService.enrollStudent(
          harness.buildStudentActor(userB),
          course.joinCode,
        );
        const studentAId = studentA.id;
        const studentBId = studentB.id;
        const [s1, s2] = [studentAId, studentBId].sort();
        const { data: match, error: matchErr } = await harness.serviceClient
          .from("study_group_matches")
          .insert({
            course_id: course.courseId,
            student1_id: s1,
            student2_id: s2,
            concept_ids: [c1],
            status: "active",
          })
          .select("id")
          .single();
        expect(matchErr).toBeNull();

        const { data: quest } = await harness.serviceClient
          .from("party_quests")
          .insert({
            match_id: match!.id,
            concept_ids: [c1],
            status: "active",
            version: 1,
          })
          .select("id")
          .single();

        const qids = [
          idGenerator.generateId(),
          idGenerator.generateId(),
          idGenerator.generateId(),
          idGenerator.generateId(),
          idGenerator.generateId(),
        ];

        // Seed Alice's completed attempt and progress (1/2 pairs complete)
        const { data: encA } = await harness.serviceClient
          .from("encounters")
          .insert({
            student_id: studentAId,
            concept_id: c1,
            source: "party",
            party_quest_id: quest!.id,
            status: "completed",
            question_ids: qids,
            option_permutations: [
              [0, 1, 2, 3],
              [0, 1, 2, 3],
              [0, 1, 2, 3],
              [0, 1, 2, 3],
              [0, 1, 2, 3],
            ],
          })
          .select("id")
          .single();

        const { data: attA } = await harness.serviceClient
          .from("quiz_attempts")
          .insert({
            student_id: studentAId,
            concept_id: c1,
            score: 1.0,
            correct_count: 5,
            total_questions: 5,
            encounter_id: encA!.id,
            submitted_answers: qids.map((qid) => ({
              question_id: qid,
              selected_option: 0,
              correct: true,
            })),
          })
          .select("id")
          .single();

        const { error: evAErr } = await harness.serviceClient
          .from("mastery_evidence")
          .insert({
            student_id: studentAId,
            concept_id: c1,
            evidence_type: "quiz",
            source_id: attA!.id,
            prior_confidence: 0.5,
            new_confidence: 0.6,
          });
        expect(evAErr).toBeNull();

        await harness.serviceClient.from("party_quest_progress").insert({
          party_quest_id: quest!.id,
          student_id: studentAId,
          concept_id: c1,
          quiz_attempt_id: attA!.id,
        });

        // Seed Bob's encounter and attempt
        const { data: encB } = await harness.serviceClient
          .from("encounters")
          .insert({
            student_id: studentBId,
            concept_id: c1,
            source: "party",
            party_quest_id: quest!.id,
            status: "completed",
            question_ids: qids,
            option_permutations: [
              [0, 1, 2, 3],
              [0, 1, 2, 3],
              [0, 1, 2, 3],
              [0, 1, 2, 3],
              [0, 1, 2, 3],
            ],
          })
          .select("id")
          .single();

        const { data: attB } = await harness.serviceClient
          .from("quiz_attempts")
          .insert({
            student_id: studentBId,
            concept_id: c1,
            score: 1.0,
            correct_count: 5,
            total_questions: 5,
            encounter_id: encB!.id,
            submitted_answers: qids.map((qid) => ({
              question_id: qid,
              selected_option: 0,
              correct: true,
            })),
          })
          .select("id")
          .single();

        const { error: evBErr } = await harness.serviceClient
          .from("mastery_evidence")
          .insert({
            student_id: studentBId,
            concept_id: c1,
            evidence_type: "quiz",
            source_id: attB!.id,
            prior_confidence: 0.5,
            new_confidence: 0.6,
          });
        expect(evBErr).toBeNull();

        // Install a temporary test trigger on xp_events that fails specifically for Bob
        const triggerSql = `
          CREATE OR REPLACE FUNCTION trigger_fail_party_xp()
          RETURNS trigger AS $$
          BEGIN
            IF NEW.student_id = '${studentBId}'::uuid AND NEW.reason = 'party' THEN
              RAISE EXCEPTION 'Simulated atomic failure during party XP insertion';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;

          DROP TRIGGER IF EXISTS trg_fail_party_xp ON public.xp_events;
          CREATE TRIGGER trg_fail_party_xp
          BEFORE INSERT ON public.xp_events
          FOR EACH ROW EXECUTE FUNCTION trigger_fail_party_xp();
        `;
        runPsql(triggerSql);

        try {
          // Bob calls RPC to record final progress -> trigger will fire and fail transaction
          const { error: failErr } = await harness.serviceClient.rpc(
            "record_party_quest_progress",
            {
              p_actor_auth_id: userB.authId,
              p_party_quest_id: quest!.id,
              p_attempt_id: attB!.id,
            },
          );

          expect(failErr).toBeDefined();

          // Verify atomic rollback: quest is still active, only 1 progress row exists, 0 XP rows exist
          const { data: questAfter } = await harness.serviceClient
            .from("party_quests")
            .select("status, version")
            .eq("id", quest!.id)
            .single();
          expect(questAfter!.status).toBe("active");
          expect(questAfter!.version).toBe(1);

          const { count: progCount } = await harness.serviceClient
            .from("party_quest_progress")
            .select("*", { count: "exact", head: true })
            .eq("party_quest_id", quest!.id);
          expect(progCount).toBe(1); // Bob's progress was rolled back!

          const { count: xpCount } = await harness.serviceClient
            .from("xp_events")
            .select("*", { count: "exact", head: true })
            .eq("source_id", quest!.id);
          expect(xpCount).toBe(0); // Zero XP awarded!
        } finally {
          // Clean up test trigger
          runPsql(`
            DROP TRIGGER IF EXISTS trg_fail_party_xp ON public.xp_events;
            DROP FUNCTION IF EXISTS trigger_fail_party_xp();
          `);
        }
      });
    },
  );
});
