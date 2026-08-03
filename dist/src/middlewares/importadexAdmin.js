"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireImportadexAdmin = exports.attachImportadexUser = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const mirex_users_service_1 = require("../services/mirex-users.service");
const getJwtSecrets = () => {
    const secrets = [process.env.MIREX_JWT_SECRET, process.env.JWT_SECRET]
        .map((secret) => secret?.trim())
        .filter((secret) => Boolean(secret));
    const uniqueSecrets = Array.from(new Set(secrets));
    if (!uniqueSecrets.length)
        throw new Error("MIREX_JWT_SECRET or JWT_SECRET is missing");
    return uniqueSecrets;
};
const verifyToken = (token) => {
    let lastError;
    for (const secret of getJwtSecrets()) {
        try {
            return jsonwebtoken_1.default.verify(token, secret, {
                algorithms: ["HS256"],
            });
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError;
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
const getDecodedUser = (decoded) => ({
    id: decoded.data?._id,
    email: decoded.data?.email ?? decoded.email,
    role: decoded.data?.role ?? decoded.role,
});
const mapMirexUser = (user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    institution: user.institution,
});
const resolveMirexUser = async (decodedUser) => {
    if (decodedUser.id) {
        const user = await (0, mirex_users_service_1.getMirexUserById)(decodedUser.id);
        if (user)
            return mapMirexUser(user);
    }
    if (decodedUser.email) {
        const user = await (0, mirex_users_service_1.getMirexUserByEmail)(decodedUser.email);
        if (user)
            return mapMirexUser(user);
    }
    return decodedUser;
};
const attachImportadexUser = async (req, _res, next) => {
    const token = getTokenFromRequest(req);
    if (!token) {
        next();
        return;
    }
    try {
        const decoded = verifyToken(token);
        req.importadexUser = await resolveMirexUser(getDecodedUser(decoded));
    }
    catch {
        req.importadexUser = undefined;
    }
    next();
};
exports.attachImportadexUser = attachImportadexUser;
const requireImportadexAdmin = async (req, res, next) => {
    const token = getTokenFromRequest(req);
    if (!token) {
        res.status(401).json({ ok: false, message: "Unauthorized" });
        return;
    }
    try {
        const decoded = verifyToken(token);
        const user = await resolveMirexUser(getDecodedUser(decoded));
        const role = user.role;
        if (!role || !["ADMIN", "IMPORTADEX_ADMIN"].includes(role)) {
            res.status(403).json({ ok: false, message: "Forbidden" });
            return;
        }
        req.importadexUser = user;
        next();
    }
    catch {
        res.status(401).json({ ok: false, message: "Unauthorized" });
    }
};
exports.requireImportadexAdmin = requireImportadexAdmin;
