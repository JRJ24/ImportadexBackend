"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireImportadexAdmin = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET;
    if (!secret)
        throw new Error("JWT_SECRET is missing");
    return secret;
};
const getTokenFromRequest = (req) => {
    const accessToken = req.headers["x-access-token"];
    if (typeof accessToken === "string")
        return accessToken;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer "))
        return authHeader.split(" ")[1];
    return undefined;
};
const requireImportadexAdmin = (req, res, next) => {
    const token = getTokenFromRequest(req);
    if (!token) {
        res.status(401).json({ ok: false, message: "Unauthorized" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, getJwtSecret(), {
            algorithms: ["HS256"],
        });
        const role = decoded.data?.role ?? decoded.role;
        if (!role || !["ADMIN", "IMPORTADEX_ADMIN"].includes(role)) {
            res.status(403).json({ ok: false, message: "Forbidden" });
            return;
        }
        next();
    }
    catch {
        res.status(401).json({ ok: false, message: "Unauthorized" });
    }
};
exports.requireImportadexAdmin = requireImportadexAdmin;
