const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { randomInt } = require("node:crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const CODE_TTL_MS = 5 * 60 * 1000;

// MVP storage: codes live in this server's memory and expire after five minutes.
// For a production service with multiple server instances, replace this Map with Redis.
const sessions = new Map();

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5500")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Allow non-browser tools/health checks with no Origin header.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "10kb" }));

const createLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many code requests. Please wait a few minutes." }
});

const lookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes." }
});

function removeExpiredSessions() {
  const now = Date.now();
  for (const [code, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(code);
  }
}
setInterval(removeExpiredSessions, 30_000).unref();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fileconnect-pairing", time: new Date().toISOString() });
});

app.post("/api/sessions", createLimiter, (req, res) => {
  const peerId = typeof req.body?.peerId === "string" ? req.body.peerId.trim() : "";

  if (!peerId || peerId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(peerId)) {
    return res.status(400).json({ error: "A valid peer ID is required." });
  }

  removeExpiredSessions();

  let code;
  // randomInt uses a cryptographically secure random source.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = String(randomInt(100000, 1000000));
    if (!sessions.has(candidate)) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    return res.status(503).json({ error: "Could not create a code. Please try again." });
  }

  const expiresAt = Date.now() + CODE_TTL_MS;
  sessions.set(code, { peerId, expiresAt });

  return res.status(201).json({
    code,
    expiresInSeconds: Math.floor(CODE_TTL_MS / 1000)
  });
});

app.post("/api/sessions/lookup", lookupLimiter, (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter a valid 6-digit code." });
  }

  const session = sessions.get(code);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(code);
    return res.status(404).json({ error: "Code not found or expired. Ask the sender to generate a new one." });
  }

  return res.json({ peerId: session.peerId });
});

app.listen(PORT, () => {
  console.log(`FileConnect pairing server listening on port ${PORT}`);
});
