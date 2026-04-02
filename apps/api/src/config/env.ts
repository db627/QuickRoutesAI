import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_API_KEY: z.string().min(1),
  GOOGLE_MAPS_SERVER_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  // Email (SMTP) config for quote notifications (optional — quote endpoint disabled if missing)
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  QUOTE_RECIPIENT_EMAIL: z.string().email().default("db627@njit.edu"),
  // Google reCAPTCHA v3 (optional — skipped if missing)
  RECAPTCHA_SECRET_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
