export {
  PoolRepository,
  type PoolEntry,
  type InsertPoolEntryInput,
  type PoolEntryStatus,
  type PoolDatabaseClientPort,
} from "./pool-repository.js";

export { MatchRepository } from "./match-repository.js";

export {
  StudyGroupService,
  type StudyGroupServiceDependencies,
} from "./study-group-service.js";

export {
  findComplementaryCandidates,
  type MatchProfile,
  type ComplementaryCandidate,
} from "./matchmaker.js";
