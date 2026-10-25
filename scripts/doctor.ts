import "dotenv/config";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { OpenRouterClient } from "../src/server/ai/index.js";
import { readSpeechSourceConfig } from "../src/server/classroom/index.js";
import { createSupabaseClients, readServerConfig } from "../src/server/platform/index.js";

export async function runDoctor(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<void> {
  // 1. Node.js runtime major version check
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 24) {
    throw new Error(`Node.js major version must be >= 24 (found v${process.versions.node})`);
  }
  console.log(`[doctor] Node.js version v${process.versions.node} OK`);

  // 2. Server configuration check
  const serverConfig = readServerConfig(env);
  console.log(`[doctor] Server configuration (NODE_ENV: ${serverConfig.nodeEnv}, PORT: ${serverConfig.port}, APP_ORIGIN: ${serverConfig.origin}) OK`);

  // 3. Credential encryption key check
  const encryptionKey = env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes)");
  }
  console.log("[doctor] Credential encryption key OK");

  // 4. Supabase configuration check
  createSupabaseClients(env);
  if (env.NEXT_PUBLIC_SUPABASE_URL !== undefined) {
    try {
      new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    } catch {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
    }
  }
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined && env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim() === "") {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY cannot be empty");
  }
  console.log("[doctor] Supabase configuration OK");

  // 5. AI integration mode and credentials
  new OpenRouterClient({ env });
  const integrationMode = env.INTEGRATION_MODE || "fixture";
  console.log(`[doctor] AI configuration (mode: ${integrationMode}) OK`);

  // 6. Speech source configuration
  const speechConfig = readSpeechSourceConfig(env);
  console.log(`[doctor] Speech source configuration (source: ${speechConfig.lectureSource}) OK`);

  // 7. Live integration mode specific checks
  if (integrationMode === "live") {
    if (!env.ZOOM_SECRET_TOKEN || env.ZOOM_SECRET_TOKEN.trim() === "") {
      throw new Error("ZOOM_SECRET_TOKEN is required and cannot be blank in live mode");
    }
    if (!env.ZOOM_REDIRECT_URI) {
      throw new Error("ZOOM_REDIRECT_URI is required in live mode");
    }

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(env.ZOOM_REDIRECT_URI);
    } catch {
      throw new Error("ZOOM_REDIRECT_URI must be a valid URL");
    }

    if (redirectUrl.origin !== serverConfig.origin) {
      throw new Error("ZOOM_REDIRECT_URI must share the same origin as APP_ORIGIN");
    }
    if (redirectUrl.pathname !== "/api/zoom/oauth/callback") {
      throw new Error("ZOOM_REDIRECT_URI must end with /api/zoom/oauth/callback");
    }
    if (
      redirectUrl.hostname !== "localhost" &&
      redirectUrl.hostname !== "127.0.0.1" &&
      redirectUrl.protocol !== "https:"
    ) {
      throw new Error("ZOOM_REDIRECT_URI must use HTTPS outside localhost");
    }

    if (speechConfig.lectureSource === "zoom") {
      if (!env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) {
        throw new Error("ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET are required when LECTURE_SOURCE=zoom");
      }
    }
    console.log("[doctor] Live Zoom provider configuration OK");
  }

  // 8. Port availability probe
  const probeServer = net.createServer();
  const { promise: portPromise, resolve: portResolve, reject: portReject } = Promise.withResolvers<void>();

  probeServer.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      portReject(new Error(`PORT is unavailable: port ${serverConfig.port} is already in use`));
    } else {
      portReject(new Error(`PORT probe failed with code: ${err.code ?? err.message}`));
    }
  });

  probeServer.once("listening", () => {
    probeServer.close(() => portResolve());
  });

  probeServer.listen(serverConfig.port, "0.0.0.0");
  await portPromise;
  console.log(`[doctor] Port ${serverConfig.port} availability probe OK`);

  // 9. Supabase reachability probes
  const supabaseUrl = env.SUPABASE_URL!.replace(/\/$/, "");
  const anonKey = env.SUPABASE_ANON_KEY!;

  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: {
        apikey: anonKey,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!authRes.ok) {
      throw new Error(`Endpoint returned HTTP ${authRes.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Request failed";
    throw new Error(`Supabase auth health probe failed: ${supabaseUrl}/auth/v1/health (${msg})`, {
      cause: err,
    });
  }

  try {
    const restRes = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: anonKey,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!restRes.ok) {
      throw new Error(`Endpoint returned HTTP ${restRes.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Request failed";
    throw new Error(`Supabase REST probe failed: ${supabaseUrl}/rest/v1/ (${msg})`, {
      cause: err,
    });
  }
  console.log("[doctor] Supabase auth and REST reachability probes OK");

  console.log("[doctor] All checks passed successfully.");
}

// Direct execution guard
if (process.env.NODE_ENV !== "test" && process.argv[1]) {
  try {
    const entryUrl = pathToFileURL(path.resolve(process.argv[1])).href;
    if (entryUrl === import.meta.url) {
      runDoctor().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[doctor] Check failed: ${msg}`);
        process.exit(1);
      });
    }
  } catch {
    // Ignore resolution failure on non-direct invocation
  }
}
