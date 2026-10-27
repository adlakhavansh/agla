import "dotenv/config";
import "./config/env.js";
import http from "node:http";
import mongoose from "mongoose";
import app, { allowedOrigins } from "./app.js";
import { initSocket } from "./socket.js";
import { sweep } from "./utils/sweeper.js";

const PORT = process.env.PORT || 8080;
const SWEEP_EVERY = 60 * 1000;
const server = http.createServer(app);
initSocket(server, allowedOrigins);

const sweepQuietly = () => sweep().catch((error) => console.error("Sweep failed:", error));

mongoose
  .connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || "agla" })
  .then(() => {
    console.log("DB connected");
    server.listen(PORT, () => console.log(`Server running on ${PORT}`));
    // Expire unpaid checkouts, mark no-shows, drop forgotten orders, retry refunds.
    if (process.env.NODE_ENV !== "test") {
      sweepQuietly();
      setInterval(sweepQuietly, SWEEP_EVERY);
    }
  })
  .catch((err) => {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  });
