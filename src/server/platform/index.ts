export {
  createSupabaseClients,
  type SupabaseClients,
} from "./supabase";

export {
  createAuthGateway,
  type AuthGateway,
} from "./auth";

export {
  requireAuth,
} from "./middleware/require-auth";

export {
  mapPostgrestError,
} from "./postgrest-error";

export {
  apiErrorHandler,
} from "./middleware/api-error-handler";

export {
  createAuthRouter,
  type AuthRouterDependencies,
} from "./auth-router";

export {
  readServerConfig,
  type ServerConfig,
} from "./server-config.js";

export {
  createDemoRouter,
  type DemoRouterDependencies,
} from "./demo/router.js";

export {
  DemoController,
  type DemoControllerDependencies,
  type DemoStateDTO,
  type DemoSpeechControlInput,
  type DemoSpeechStateDTO,
} from "./demo/controller.js";

export {
  readDemoConfig,
  detectDbContainer,
  type DemoConfig,
  type DemoPersona,
} from "./demo/config.js";

export {
  seedDemoDatabase,
  resetDemoDatabase,
  type DemoSeedResult,
} from "./demo/seed-store.js";

export {
  buildDemoDataset,
  demoId,
  DEFAULT_DEMO_NAMESPACE,
  DEMO_PASSWORD,
  type DemoDataset,
  type DemoDatasetScope,
} from "./demo/dataset.js";
