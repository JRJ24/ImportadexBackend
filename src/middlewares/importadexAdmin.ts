import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getMirexUserByEmail, getMirexUserById, type MirexUserSummary } from "../services/mirex-users.service";

interface ImportadexAdminToken extends jwt.JwtPayload {
  data?: {
    _id?: string;
    email?: string;
    role?: string;
  };
  email?: string;
  role?: string;
}

export interface ImportadexAuthUser {
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  institution?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      importadexUser?: ImportadexAuthUser;
    }
  }
}

const getJwtSecrets = () => {
  const secrets = [process.env.MIREX_JWT_SECRET, process.env.JWT_SECRET]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));

  const uniqueSecrets = Array.from(new Set(secrets));
  if (!uniqueSecrets.length) throw new Error("MIREX_JWT_SECRET or JWT_SECRET is missing");
  return uniqueSecrets;
};

const verifyToken = (token: string) => {
  let lastError: unknown;

  for (const secret of getJwtSecrets()) {
    try {
      return jwt.verify(token, secret, {
        algorithms: ["HS256"],
      }) as ImportadexAdminToken;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

const getTokenFromRequest = (req: Request) => {
  const accessToken = req.headers["x-access-token"];

  if (typeof accessToken === "string") return accessToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.split(" ")[1];

  return undefined;
};

const getDecodedUser = (decoded: ImportadexAdminToken): ImportadexAuthUser => ({
  id: decoded.data?._id,
  email: decoded.data?.email ?? decoded.email,
  role: decoded.data?.role ?? decoded.role,
});

const normalizeAccessValue = (value?: string | null) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

const importadexInstitutionKey = normalizeAccessValue("Importadex / Flypack");

const isImportadexInstitution = (institution?: string | null) =>
  normalizeAccessValue(institution) === importadexInstitutionKey;

const isImportadexAdminRole = (role?: string) =>
  Boolean(role && ["ADMIN", "IMPORTADEX_ADMIN"].includes(role));

const canManageImportadexClients = (user: ImportadexAuthUser) => {
  const role = user.role;
  if (isImportadexAdminRole(role)) return true;
  return role === "OPERACIONES" && isImportadexInstitution(user.institution);
};

const mapMirexUser = (user: MirexUserSummary): ImportadexAuthUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  institution: user.institution,
});

const resolveMirexUser = async (decodedUser: ImportadexAuthUser) => {
  if (decodedUser.id) {
    const user = await getMirexUserById(decodedUser.id);
    if (user) return mapMirexUser(user);
  }

  if (decodedUser.email) {
    const user = await getMirexUserByEmail(decodedUser.email);
    if (user) return mapMirexUser(user);
  }

  return decodedUser;
};

export const attachImportadexUser = async (req: Request, _res: Response, next: NextFunction) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    next();
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.importadexUser = await resolveMirexUser(getDecodedUser(decoded));
  } catch {
    req.importadexUser = undefined;
  }

  next();
};

export const requireImportadexAdmin = async (req: Request, res: Response, next: NextFunction) => {
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
  } catch {
    res.status(401).json({ ok: false, message: "Unauthorized" });
  }
};

export const requireImportadexClientManager = async (req: Request, res: Response, next: NextFunction) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    res.status(401).json({ ok: false, message: "Unauthorized" });
    return;
  }

  try {
    const decoded = verifyToken(token);
    const user = await resolveMirexUser(getDecodedUser(decoded));

    if (!canManageImportadexClients(user)) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    req.importadexUser = user;
    next();
  } catch {
    res.status(401).json({ ok: false, message: "Unauthorized" });
  }
};
