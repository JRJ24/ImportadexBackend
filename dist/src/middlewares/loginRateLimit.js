"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginRateLimit = void 0;
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const attempts = new Map();
const loginRateLimit = (req, res, next) => {
    const loginKey = typeof req.body?.email === "string"
        ? req.body.email.toLowerCase()
        : typeof req.body?.identification === "string"
            ? req.body.identification.replace(/\D/g, "")
            : "";
    const key = `${req.ip ?? "unknown"}:${loginKey}`;
    const now = Date.now();
    const bucket = attempts.get(key);
    if (!bucket || bucket.resetAt <= now) {
        attempts.set(key, {
            count: 1,
            resetAt: now + WINDOW_MS,
        });
        next();
        return;
    }
    if (bucket.count >= MAX_ATTEMPTS) {
        res.status(429).json({
            message: "Demasiados intentos. Intente nuevamente en un minuto",
        });
        return;
    }
    bucket.count += 1;
    next();
};
exports.loginRateLimit = loginRateLimit;
