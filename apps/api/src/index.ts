import "dotenv/config";
import { env } from "./config/env";
import express from "express";
import cors from "cors";
import { requestLogger } from "./middleware/logger";
import { globalLimiter, quoteLimiter } from "./middleware/rateLimiter";
import { verifyFirebaseToken } from "./middleware/auth";
import healthRoutes from "./routes/health";
import meRoutes from "./routes/me";
import authRoutes from "./routes/auth";
import driverRoutes from "./routes/drivers";
import tripRoutes from "./routes/trips";
import userRoutes from "./routes/users";
import aiRoutes from "./routes/ai";
import quoteRoutes from "./routes/quote";
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

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`QuickRoutesAI API running on http://0.0.0.0:${env.PORT}`);
});
