import { AppError } from "../../contracts/errors.js";

export function mapPostgrestError(
  error: unknown,
  contextMessage: string,
  profile: "aggregate" | "poll" = "aggregate",
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  let code = "";
  let message: string | undefined;
  if (typeof error === "object" && error !== null) {
    if ("code" in error && typeof error.code === "string") {
      code = error.code;
    }
    if ("message" in error && typeof error.message === "string") {
      message = error.message;
    }
  }

  if (code === "PGRST000" || code === "PGRST001" || code === "PGRST002") {
    return new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message:
        profile === "poll"
          ? `${contextMessage}: Database service unavailable`
          : contextMessage,
      cause: error,
    });
  }

  if (code === "42501") {
    return new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: `${contextMessage}: Permission denied`,
      cause: error,
    });
  }

  if (profile === "poll" && code === "P0002") {
    return new AppError({
      code: "NOT_FOUND",
      statusCode: 404,
      message: `${contextMessage}: Record not found`,
      cause: error,
    });
  }

  const fallbackMessage =
    profile === "poll" ? "Database error" : "Unexpected database error";
  const detailMessage =
    message && message.trim().length > 0 ? message : fallbackMessage;

  return new AppError({
    code: "INTERNAL_SERVER_ERROR",
    statusCode: 500,
    message: `${contextMessage}: ${detailMessage}`,
    cause: error,
  });
}
