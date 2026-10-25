import { z } from "zod";
import { apiErrorSchema, DomainErrorCode } from "@/contracts/errors";
import { getAccessToken } from "./session";
export class ClientApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
  }
}

export interface RequestJsonOptions {
  getAccessToken: () => Promise<string | null>;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Reads the runtime client access token from the session manager.
 * Delegates to getAccessToken() in session.ts.
 */
export async function getRuntimeAccessToken(): Promise<string | null> {
  return getAccessToken();
}

/**
 * Performs an authenticated HTTP JSON request against the same origin.
 * Never leaks access tokens in logging or error details.
 */
export async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestJsonOptions
): Promise<T> {
  const token = await options.getAccessToken();
  if (!token) {
    throw new ClientApiError(
      401,
      DomainErrorCode.UNAUTHORIZED,
      "Authentication required to access lecture service"
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: options.signal,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new ClientApiError(
      0,
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "Network request failed"
    );
  }

  if (!response.ok) {
    let errorCode = "HTTP_ERROR";
    let errorMessage = `Request failed with status ${response.status}`;

    try {
      const errorJson: unknown = await response.json();
      const parsed = apiErrorSchema.safeParse(errorJson);
      if (parsed.success) {
        errorCode = parsed.data.error.code;
        errorMessage = parsed.data.error.message;
      }
    } catch {
      // Non-JSON error payload, retain fallback HTTP error status
    }

    throw new ClientApiError(response.status, errorCode, errorMessage);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err: unknown) {
    console.error("[http] Invalid JSON response from server", {
      path,
      status: response.status,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ClientApiError(response.status, "INVALID_RESPONSE", "Invalid server response");
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error("[http] Schema validation failed for response", {
      path,
      status: response.status,
      issues: parsed.error.issues,
    });
    throw new ClientApiError(response.status, "INVALID_RESPONSE", "Invalid server response");
  }

  return parsed.data;
}
