import rateLimit from "express-rate-limit";
import { env } from "../config/env";

const isTest = env.NODE_ENV === "test";

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
  message: { error: "Too Many Requests", message: "Rate limit exceeded, try again in a minute" },
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
  message: { error: "Too Many Requests", message: "Too many login attempts, try again in a minute" },
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
  message: { error: "Too Many Requests", message: "Too many signup attempts, try again in a minute" },
});
