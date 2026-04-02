import { env } from "../config/env";

export const isRecaptchaConfigured = !!env.RECAPTCHA_SECRET_KEY;

interface RecaptchaResponse {
  success: boolean;
  score: number;
  action: string;
  challenge_ts: string;
  hostname: string;
  "error-codes"?: string[];
}

/**
 * Verify a reCAPTCHA v3 token. Returns true if the token is valid and the
 * score is above the threshold (0.5 by default).
 *
 * If RECAPTCHA_SECRET_KEY is not set, always returns valid (dev mode).
 */
export async function verifyRecaptcha(
  token: string,
  expectedAction = "submit_quote",
  threshold = 0.5,
): Promise<{ valid: boolean; score: number }> {
  if (!isRecaptchaConfigured) {
    console.warn("reCAPTCHA not configured — skipping verification");
    return { valid: true, score: 1 };
  }

  const params = new URLSearchParams({
    secret: env.RECAPTCHA_SECRET_KEY!,
    response: token,
  });

  const res = await fetch(
    "https://www.google.com/recaptcha/api/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  const data = (await res.json()) as RecaptchaResponse;

  if (!data.success) {
    console.warn("reCAPTCHA verification failed:", data["error-codes"]);
    return { valid: false, score: 0 };
  }

  if (data.action !== expectedAction) {
    console.warn(
      `reCAPTCHA action mismatch: expected "${expectedAction}", got "${data.action}"`,
    );
    return { valid: false, score: data.score };
  }

  return { valid: data.score >= threshold, score: data.score };
}
