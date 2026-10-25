import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext, MasteryBand, UUID } from "../../../../src/contracts/common.js";
import type {
  MasteryEvidence,
  MasteryService,
} from "../../../../src/contracts/mastery.js";
import { applyMasteryEvidence } from "../../../../src/contracts/mastery.js";
import {
  AttendanceEvidenceService,
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
} from "../../../../src/server/core/index.js";

export interface FixtureMasteryState {
  confidence: number;
  attempts: number;
  version: number;
}

export function createFixtureAttendanceService(client: SupabaseClient): {
  attendance: AttendanceEvidenceService;
  mastery: Map<string, FixtureMasteryState>;
} {
  const mastery = new Map<string, FixtureMasteryState>();

  const fakeMastery: Pick<MasteryService, "applyEvidence"> = {
    async applyEvidence(
      _actor: ActorContext,
      studentId: UUID,
      conceptId: UUID,
      evidence: MasteryEvidence,
    ): Promise<{ confidence: number; band: MasteryBand; attempts: number; version: number }> {
      const key = `${studentId}:${conceptId}`;
      const current = mastery.get(key) ?? { confidence: 0, attempts: 0, version: 0 };
      const { confidence, band } = applyMasteryEvidence(current.confidence, evidence);
      const next: FixtureMasteryState = {
        confidence,
        attempts: current.attempts,
        version: current.version + 1,
      };
      mastery.set(key, next);
      return {
        confidence: next.confidence,
        band,
        attempts: next.attempts,
        version: next.version,
      };
    },
  };

  const courseRepo = new CourseRepository(client);
  const idGen = new CryptoIdGenerator();
  const courseService = new CourseService(courseRepo, idGen);

  const attendance = new AttendanceEvidenceService(client, courseService, fakeMastery);

  return { attendance, mastery };
}
