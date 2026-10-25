import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../../contracts/errors.js";

export function apiErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json(error.toResponse());
    return;
  }
  const internalErr = new AppError({
    code: "INTERNAL_SERVER_ERROR",
    statusCode: 500,
    message: "An internal server error occurred",
    cause: error,
  });
  res.status(500).json(internalErr.toResponse());
}
