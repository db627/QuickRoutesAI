import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, service: "QuickRoutesAI API" });
});

export default router;
