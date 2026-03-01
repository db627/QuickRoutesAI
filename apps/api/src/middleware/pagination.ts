import type { NextFunction, Request, Response } from "express";

export type PaginationOptions =
  | { mode: "page"; page: number; limit: number }
  | { mode: "cursor"; page: number; limit: number; cursor: string };

// Extend Express Request type (you already do this in auth.ts)
declare global {
  namespace Express {
    interface Request {
      pagination?: PaginationOptions;
    }
  }
}

function toInt(value: unknown): number | null {
  if (value == null) return null;
  if (Array.isArray(value)) return null; // reject repeated params like ?page=1&page=2
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function badRequest(res: Response, message: string, details?: Record<string, unknown>) {
  return res.status(400).json({
    error: "Bad Request",
    message,
    ...(details ? { details } : {}),
  });
}

/**
 * Reusable pagination middleware.
 *
 * Supports:
 * - page-based: ?page=1&limit=20
 * - cursor-based: ?cursor=...&limit=20
 *
 * Rules:
 * - page default 1
 * - limit default 20, max 100
 * - limit <= 0 => 400
 * - page < 1 => 400
 * - cursor is alternative to page; if cursor is present and page param is provided => 400
 */
export function pagination(req: Request, res: Response, next: NextFunction) {
  const pageRaw = req.query.page;
  const limitRaw = req.query.limit;
  const cursorRaw = req.query.cursor;

  const hasCursor = cursorRaw != null && String(cursorRaw).length > 0;
  const hasPageParam = pageRaw != null; // explicitly provided

  // Enforce mutual exclusivity: cursor is an alternative to page-based pagination
  if (hasCursor && hasPageParam) {
    return badRequest(res, "Provide either 'page' or 'cursor', not both.", {
      page: pageRaw,
      cursor: cursorRaw,
    });
  }

  // Parse limit
  const limitParsed = toInt(limitRaw);
  const limit = limitParsed == null ? 20 : limitParsed;

  if (!Number.isInteger(limit) || limit <= 0) {
    return badRequest(res, "'limit' must be a positive integer.", { limit: limitRaw });
  }
  if (limit > 100) {
    return badRequest(res, "'limit' must be at most 100.", { limit: limitRaw });
  }

  // Cursor-mode
  if (hasCursor) {
    if (Array.isArray(cursorRaw)) {
      return badRequest(res, "'cursor' must be a single value.", { cursor: cursorRaw });
    }

    req.pagination = {
      mode: "cursor",
      page: 1, // page isn't meaningful in cursor-mode, but the envelope requires a page number
      limit,
      cursor: String(cursorRaw),
    };

    return next();
  }

  // Page-mode
  const pageParsed = toInt(pageRaw);
  const page = pageParsed == null ? 1 : pageParsed;

  if (!Number.isInteger(page) || page < 1) {
    return badRequest(res, "'page' must be an integer greater than or equal to 1.", { page: pageRaw });
  }

  req.pagination = {
    mode: "page",
    page,
    limit,
  };

  return next();
}