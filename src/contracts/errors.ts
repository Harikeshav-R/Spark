import { z } from "zod";

export const DomainErrorCode = {
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNPROCESSABLE_ENTITY: "UNPROCESSABLE_ENTITY",
  BAD_GATEWAY: "BAD_GATEWAY",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  GATEWAY_TIMEOUT: "GATEWAY_TIMEOUT",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

export type DomainErrorCode = (typeof DomainErrorCode)[keyof typeof DomainErrorCode];

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});

export interface AppErrorParams {
  code: string;
  message: string;
  statusCode?: number;
  requestId?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string;

  constructor(params: AppErrorParams) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.requestId =
      params.requestId ??
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "00000000-0000-0000-0000-000000000000");
    if (params.cause) {
      this.cause = params.cause;
    }
  }

  toResponse(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId: this.requestId,
      },
    };
  }
}
