import { Router, Request, Response } from "express";
import { z } from "zod";
import admin from "firebase-admin";
import { db } from "../config/firebase";
import { sendQuoteEmail } from "../services/email";

const router = Router();

const quoteSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(254),
  company: z.string().min(1).max(200),
  fleetSize: z.string().min(1).max(50),
  message: z.string().max(2000).optional(),
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

  const quoteData = parsed.data;

  // Persist the lead so it isn't lost if the email send fails
  try {
    await db.collection("quoteRequests").add({
      ...quoteData,
      source: "landing-page",
      status: "new",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to persist quote request:", err);
    res.status(500).json({
      error: "Storage Error",
      message: "Failed to save your request. Please try again later.",
    });
    return;
  }

  // Send the email (best-effort; the lead is already saved)
  try {
    await sendQuoteEmail(quoteData);
  } catch (err) {
    console.error("Failed to send quote email:", err);
  }

  res.status(200).json({ success: true });
});

export default router;
