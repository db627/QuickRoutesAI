import "dotenv/config";
import { env } from "./config/env";
import express from "express";
import cors from "cors";
import { requestLogger } from "./middleware/logger";
import { globalLimiter, quoteLimiter, telemetryLimiter } from "./middleware/rateLimiter";
import { verifyFirebaseToken } from "./middleware/auth";
import healthRoutes from "./routes/health";
import meRoutes from "./routes/me";
import authRoutes from "./routes/auth";
import driverRoutes from "./routes/drivers";
import tripRoutes from "./routes/trips";
import userRoutes from "./routes/users";
import aiRoutes from "./routes/ai";
import insightsRoutes from "./routes/insights";
import quoteRoutes from "./routes/quote";
import orgRoutes from "./routes/orgs";
import telemetryRoutes from "./routes/telemetry";
import { errorHandler } from "./middleware/errorHandler";
const app = express();

// Global middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(globalLimiter);

// Public routes
app.use("/health", healthRoutes);
app.use("/auth", authRoutes); // login & signup are public; setup applies its own middleware
app.use("/quote", quoteLimiter, quoteRoutes);

// Protected routes (require Firebase auth)
app.use("/me", verifyFirebaseToken, meRoutes);
app.use("/drivers", verifyFirebaseToken, driverRoutes);
app.use("/trips", verifyFirebaseToken, tripRoutes);
app.use("/users", verifyFirebaseToken, userRoutes);
app.use("/ai", verifyFirebaseToken, aiRoutes);
app.use("/orgs", verifyFirebaseToken, orgRoutes);
app.use("/insights", verifyFirebaseToken, insightsRoutes);
app.use("/telemetry", verifyFirebaseToken, telemetryLimiter, telemetryRoutes);

// Global error handler
app.use(errorHandler);

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`QuickRoutesAI API running on http://0.0.0.0:${env.PORT}`);
});
