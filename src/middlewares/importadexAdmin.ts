import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

interface ImportadexAdminToken extends jwt.JwtPayload {
  data?: {
    _id?: string;
    email?: string;
    role?: string;
  };
  email?: string;
  role?: string;
}

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing");
  return secret;
};

const getTokenFromRequest = (req: Request) => {
  const accessToken = req.headers["x-access-token"];

  if (typeof accessToken === "string") return accessToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.split(" ")[1];

  return undefined;
};

export const requireImportadexAdmin = (req: Request, res: Response, next: NextFunction) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    res.status(401).json({ ok: false, message: "Unauthorized" });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    }) as ImportadexAdminToken;
    const role = decoded.data?.role ?? decoded.role;

    if (!role || !["ADMIN", "IMPORTADEX_ADMIN"].includes(role)) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    next();
  } catch {
    res.status(401).json({ ok: false, message: "Unauthorized" });
  }
};
