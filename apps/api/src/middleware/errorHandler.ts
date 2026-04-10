import { Request, Response, NextFunction } from "express";
import { ErrorCode, ERROR_MESSAGES } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    console.error(`[${err.code}] ${err.message}`, err.stack);
    const body: Record<string, unknown> = { error: err.code, message: err.message };
    if (err.details) body.details = err.details;
    res.status(err.statusCode).json(body);
    return;
  }

  // Unknown errors — log full stack server-side, never leak it in the response
  console.error("Unhandled error:", err.stack ?? err.message);
  res.status(500).json({
    error: ErrorCode.INTERNAL_ERROR,
    message: ERROR_MESSAGES[ErrorCode.INTERNAL_ERROR],
  });
}
