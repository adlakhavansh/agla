import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import authRoutes from "./routes/auth.routes.js";
import canteenRoutes from "./routes/canteen.routes.js";
import orderRoutes from "./routes/order.routes.js";
import inviteRoutes from "./routes/invite.routes.js";
import { sweep } from "./utils/sweeper.js";
import { notFound, errorHandler } from "./middlewares/error.middleware.js";

const app = express();
app.disable("x-powered-by");

export const allowedOrigins = process.env.CLIENT_URL.split(",").map((origin) => origin.trim());

// Render sits one proxy hop in front of us; without this req.ip is the proxy.
app.set("trust proxy", 1);

// Keyed by email when there is one: behind the Vercel rewrite, a whole hostel shares one IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : ipKeyGenerator(req.ip)),
  message: { message: "Too many attempts, try again in a few minutes" },
});

const internalOk = (req) => {
  const expected = Buffer.from(`Bearer ${process.env.INTERNAL_SECRET}`);
  const given = Buffer.from(String(req.get("authorization") ?? ""));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api", cors({ origin: allowedOrigins, credentials: true }), express.json({ limit: "20kb" }), cookieParser());
app.use("/api/auth", (req, res, next) => (req.method === "POST" ? authLimiter(req, res, next) : next()), authRoutes);
app.use("/api/canteens", canteenRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/invites", inviteRoutes);

// An outside cron (cron-job.org) calls this every few minutes, which also wakes a sleeping server.
app.post("/internal/sweep", async (req, res) => {
  if (!internalOk(req)) return res.status(401).json({ message: "Not allowed" });
  res.json({ swept: await sweep() });
});

app.use(notFound);
app.use(errorHandler);

export default app;
