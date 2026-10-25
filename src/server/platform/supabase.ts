import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../contracts/errors";

export interface SupabaseClients {
  authClient: SupabaseClient;
  databaseClient: SupabaseClient;
}

export function createSupabaseClients(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SupabaseClients {
  const missing: string[] = [];
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: `Missing required Supabase configuration: ${missing.join(", ")}`,
    });
  }

  try {
    new URL(env.SUPABASE_URL!);
  } catch {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Invalid SUPABASE_URL configuration",
    });
  }

  const authClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const databaseClient = createClient(
    env.SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  return { authClient, databaseClient };
}
