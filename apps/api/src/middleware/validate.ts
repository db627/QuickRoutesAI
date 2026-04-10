import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { ErrorCode } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

/**
 * Express middleware that validates req.body against a Zod schema.
 * On failure, passes an AppError to next() with field-level details.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Invalid request body",
            err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
          ),
        );
      }
      next(err);
    }
  };
}
