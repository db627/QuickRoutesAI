export const ErrorCode = {
  // Auth
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  // Resources
  TRIP_NOT_FOUND: "TRIP_NOT_FOUND",
  DRIVER_NOT_FOUND: "DRIVER_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  // Trip logic
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  // External services
  GEOCODING_FAILED: "GEOCODING_FAILED",
  DIRECTIONS_FAILED: "DIRECTIONS_FAILED",
  // Input
  VALIDATION_ERROR: "VALIDATION_ERROR",
  // Rate limiting
  RATE_LIMITED: "RATE_LIMITED",
  // General
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Missing or invalid token",
  FORBIDDEN: "You do not have permission to perform this action",
  TRIP_NOT_FOUND: "Trip not found",
  DRIVER_NOT_FOUND: "Driver not found",
  USER_NOT_FOUND: "User not found",
  INVALID_STATUS_TRANSITION: "Invalid status transition",
  GEOCODING_FAILED: "Failed to geocode address",
  DIRECTIONS_FAILED: "Failed to compute directions",
  VALIDATION_ERROR: "Invalid request body",
  RATE_LIMITED: "Rate limit exceeded, try again later",
  INTERNAL_ERROR: "An unexpected error occurred",
  NOT_FOUND: "Resource not found",
  BAD_REQUEST: "Bad request",
  CONFLICT: "Conflict",
};
