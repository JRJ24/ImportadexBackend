"use strict";
// import { NextFunction, Request, Response } from "express";
// import * as jwt from "jsonwebtoken";
// import type { Role } from "../../generated/prisma/enums";
// import { can, PermissionAction } from "../config/permissions";
// import { prisma } from "../config/connectionDB";
Object.defineProperty(exports, "__esModule", { value: true });
// const revokedTokens = new Set<string>();
// export interface AuthUser {
//   id: string;
//   email: string;
//   name: string;
//   role: Role;
//   active: boolean;
// }
// declare global {
//   namespace Express {
//     interface User extends AuthUser {}
//     interface Request {
//       token?: string;
//     }
//   }
// }
// export type AuthRequest<P = Record<string, string>> = Request<P>;
// interface IDecodedToken extends jwt.JwtPayload {
//   data: {
//     _id: string;
//   };
// }
// export const getJwtSecret = () => {
//   const secret = process.env.JWT_SECRET;
//   if (!secret) {
//     throw new Error("JWT_SECRET is missing");
//   }
//   return secret;
// };
// export const getTokenFromRequest = (req: Request) => {
//   const accessToken = req.headers["x-access-token"];
//   if (typeof accessToken === "string") return accessToken;
//   const authHeader = req.headers.authorization;
//   if (authHeader?.startsWith("Bearer ")) {
//     return authHeader.split(" ")[1];
//   }
//   return undefined;
// };
// export const revokeJWT = (token: string) => {
//   revokedTokens.add(token);
// };
// export const isJWTRevoked = (token: string) => {
//   return revokedTokens.has(token);
// };
// export const generateJWT = (data: { _id: string }) => {
//   return new Promise<string>((resolve, reject) => {
//     jwt.sign(
//       { data },
//       getJwtSecret(),
//       {
//         algorithm: "HS256",
//         expiresIn: "8h",
//       },
//       (err, token) => {
//         if (err || !token) {
//           reject("Couldn't generate token");
//         } else {
//           resolve(token);
//         }
//       },
//     );
//   });
// };
// export const validatJWT = async (
//   req: AuthRequest,
//   res: Response,
//   next: NextFunction,
// ) => {
//   const token = getTokenFromRequest(req);
//   if (!token || isJWTRevoked(token)) {
//     res.status(401).json({ message: "Unauthorized" });
//     return;
//   }
//   try {
//     // const { prisma } = await import("../config/connectionDB");
//     const decoded = jwt.verify(token, getJwtSecret(), {
//       algorithms: ["HS256"],
//     }) as IDecodedToken;
//     const user = await prisma.user.findUnique({
//       where: {
//         id: decoded.data._id,
//       },
//       select: {
//         id: true,
//         email: true,
//         name: true,
//         role: true,
//         active: true,
//       },
//     });
//     if (!user?.active) {
//       res.status(401).json({ message: "Unauthorized" });
//       return;
//     }
//     req.user = user;
//     req.token = token;
//     next();
//   } catch (_error) {
//     res.status(401).json({ message: "Unauthorized" });
//   }
// };
// export const requireRole = (...roles: Role[]) => {
//   return (req: AuthRequest, res: Response, next: NextFunction) => {
//     if (!req.user) {
//       res.status(401).json({ message: "Unauthorized" });
//       return;
//     }
//     if (!roles.includes(req.user.role)) {
//       res.status(403).json({ message: "Forbidden" });
//       return;
//     }
//     next();
//   };
// };
// export const requirePermission = (action: PermissionAction) => {
//   return (req: AuthRequest, res: Response, next: NextFunction) => {
//     if (!req.user) {
//       res.status(401).json({ message: "Unauthorized" });
//       return;
//     }
//     if (!can(req.user.role, action)) {
//       res.status(403).json({ message: "Forbidden" });
//       return;
//     }
//     next();
//   };
// };
// export const deleteJWT = async (token: string) => {
//   revokeJWT(token);
// };
