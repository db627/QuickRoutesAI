import { ErrorCode, ERROR_MESSAGES } from "@quickroutesai/shared";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message?: string,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = "AppError";
  }
}
