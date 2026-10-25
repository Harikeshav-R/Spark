export interface RuntimeSession {
  accessToken: string;
  expiresAt: number; // Unix seconds
}

let inMemorySession: RuntimeSession | null = null;
let sessionGeneration = 0;
let inFlightRefreshPromise: Promise<string | null> | null = null;

export function setRuntimeSession(session: RuntimeSession | null): void {
  inMemorySession = session;
  sessionGeneration++;
  inFlightRefreshPromise = null;
}

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export async function getAccessToken(): Promise<string | null> {
  const nowUnixSec = Math.floor(Date.now() / 1000);

  // If in-memory session is still valid (with 30-second expiry margin)
  if (inMemorySession && inMemorySession.expiresAt - nowUnixSec > 30) {
    return inMemorySession.accessToken;
  }

  // If there's an ongoing refresh, wait for it
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  // Non-browser environments cannot perform browser-cookie refresh
  if (typeof window === "undefined") {
    return inMemorySession?.accessToken ?? null;
  }

  const capturedGeneration = sessionGeneration;
  inFlightRefreshPromise = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (res.status === 401) {
        if (sessionGeneration === capturedGeneration) {
          inMemorySession = null;
        }
        return null;
      }

      if (!res.ok) {
        const errorJson: unknown = await res.json().catch(() => null);
        let message = `Authentication refresh failed with status ${res.status}`;
        if (
          errorJson &&
          typeof errorJson === "object" &&
          "message" in errorJson &&
          typeof errorJson.message === "string"
        ) {
          message = errorJson.message;
        }
        throw new Error(message);
      }

      const data: unknown = await res.json();
      let newAccessToken: string | null = null;
      let expiresAt: number = Math.floor(Date.now() / 1000) + 3600;
      if (
        data &&
        typeof data === "object" &&
        "session" in data &&
        data.session &&
        typeof data.session === "object"
      ) {
        const sessionObj = data.session;
        if ("accessToken" in sessionObj && typeof sessionObj.accessToken === "string") {
          newAccessToken = sessionObj.accessToken;
        }
        if ("expiresAt" in sessionObj && typeof sessionObj.expiresAt === "number") {
          expiresAt = sessionObj.expiresAt;
        }
      }

      if (newAccessToken && sessionGeneration === capturedGeneration) {
        inMemorySession = {
          accessToken: newAccessToken,
          expiresAt,
        };
        return newAccessToken;
      }

      return inMemorySession?.accessToken ?? null;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

// Expose setRuntimeSession on window in browser for tests or client script hooks
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__spark_set_session = setRuntimeSession;
}
