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
