import { Router, Request, Response } from "express";
import { z } from "zod";
import { sendQuoteEmail } from "../services/email";
import { verifyRecaptcha } from "../services/recaptcha";

const router = Router();

const quoteSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(254),
  company: z.string().min(1).max(200),
  fleetSize: z.string().min(1).max(50),
  message: z.string().max(2000).optional(),
  recaptchaToken: z.string().min(1),
});

router.post("/", async (req: Request, res: Response) => {
  // Validate body
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation Error",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { recaptchaToken, ...quoteData } = parsed.data;

  // Verify reCAPTCHA
  const captcha = await verifyRecaptcha(recaptchaToken);
  if (!captcha.valid) {
    console.warn(`reCAPTCHA rejected: score=${captcha.score}`);
    res.status(403).json({
      error: "Captcha Failed",
      message:
        "We couldn't verify you're human. Please try again.",
    });
    return;
  }

  // Send the email
  try {
    await sendQuoteEmail(quoteData);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Failed to send quote email:", err);
    res.status(500).json({
      error: "Email Error",
      message: "Failed to send your request. Please try again later.",
    });
  }
});

export default router;
