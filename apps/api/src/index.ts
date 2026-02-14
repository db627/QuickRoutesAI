import "dotenv/config";
import { env } from "./config/env";
import express from "express";
import cors from "cors";
import { requestLogger } from "./middleware/logger";
import { verifyFirebaseToken } from "./middleware/auth";
import healthRoutes from "./routes/health";
import meRoutes from "./routes/me";
import authRoutes from "./routes/auth";
import driverRoutes from "./routes/drivers";
import tripRoutes from "./routes/trips";

const app = express();

// Global middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Public routes
app.use("/health", healthRoutes);

// Protected routes (require Firebase auth)
app.use("/auth", verifyFirebaseToken, authRoutes);
app.use("/me", verifyFirebaseToken, meRoutes);
app.use("/drivers", verifyFirebaseToken, driverRoutes);
app.use("/trips", verifyFirebaseToken, tripRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

app.listen(env.PORT, () => {
  console.log(`QuickRoutesAI API running on http://localhost:${env.PORT}`);
});
