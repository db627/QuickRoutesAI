import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { ErrorCode, ERROR_MESSAGES } from "@quickroutesai/shared";

const isTest = env.NODE_ENV === "test";

const rateLimitedMessage = (detail: string) => ({
  error: ErrorCode.RATE_LIMITED,
  message: detail,
});

/**
 * Global rate limiter — applies to all routes.
 * 100 requests per minute per IP.
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: rateLimitedMessage("Rate limit exceeded, try again in a minute"),
});

/**
 * Stricter limiter for login attempts.
 * 10 requests per minute per IP.
 */
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: rateLimitedMessage("Too many login attempts, try again in a minute"),
});

/**
 * Stricter limiter for signup attempts.
 * 5 requests per minute per IP.
 */
export const signupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: rateLimitedMessage("Too many signup attempts, try again in a minute"),
});

/**
 * Limiter for quote submissions.
 * 3 requests per 5 minutes per IP.
 */
export const quoteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: rateLimitedMessage("Too many quote requests, please try again later"),
});

/**
 * Limiter for driver GPS telemetry batches.
 * 1 request per 5 seconds per driver UID.
 * Must run after verifyFirebaseToken so req.uid is available.
 */
export const telemetryLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).uid ?? req.ip ?? "unknown",
  skip: () => isTest,
  message: rateLimitedMessage("Telemetry rate limit exceeded: max 1 request per 5 seconds"),
});
