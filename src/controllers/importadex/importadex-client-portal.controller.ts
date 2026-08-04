import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { UploadedFile } from "../../middlewares/processFiles";
import {
  ImportadexClientPortalError,
  importadexClientPortalService,
  type ImportadexPortalClient,
} from "../../services/importadex/importadex-client-portal.service";
import {
  importadexClientPortalAttachmentSchema,
  importadexClientPortalLoginSchema,
  importadexClientPortalOtpSchema,
} from "../../validators/importadex.schemas";

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ ok: true, data });

const getUploadedFiles = (req: Request) => {
  const body = req.body as { uploadedFiles?: UploadedFile[] };
  return Array.isArray(body.uploadedFiles) ? body.uploadedFiles : [];
};

const getClientToken = (req: Request) => {
  const clientToken = req.headers["x-client-access-token"];
  if (typeof clientToken === "string") return clientToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.split(" ")[1];

  return undefined;
};

const handleError = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ ok: false, message: "Datos invalidos", errors: error.flatten().fieldErrors });
    return true;
  }

  if (error instanceof ImportadexClientPortalError) {
    res.status(error.status).json({ ok: false, message: error.message });
    return true;
  }

  return false;
};

async function requireClient(req: Request) {
  return importadexClientPortalService.authenticate(getClientToken(req));
}

function emitClientDocumentUploaded(req: Request, client: ImportadexPortalClient, operation: unknown, files: UploadedFile[], documentId?: string | null) {
  const io = req.app.get("socketio") as { to?: (room: string) => { emit: (event: string, payload: unknown) => void } } | undefined;
  if (!io) return;

  const record = operation && typeof operation === "object" ? operation as Record<string, unknown> : {};
  const operationId = typeof record.id === "string" ? record.id : undefined;
  const operationCode = typeof record.code === "string" ? record.code : operationId;
  const payload = {
    operationId,
    operationCode,
    clientId: client.id,
    clientName: `${client.name}${client.lastName ? ` ${client.lastName}` : ""}`,
    documentId: documentId ?? null,
    fileNames: files.map((file) => file.originalName || file.fileName),
    uploadedAt: new Date().toISOString(),
  };

  const operationsRoom = io.to?.("importadex:operations");
  const clientRoom = io.to?.(`importadex:client:${client.id}`);

  operationsRoom?.emit("importadex:client-document-uploaded", payload);
  clientRoom?.emit("importadex:client-document-uploaded", payload);
}

export const importadexClientPortalController = {
  async requestLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = importadexClientPortalLoginSchema.parse(req.body);
      ok(res, await importadexClientPortalService.requestLogin(payload.identification), 201);
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },

  async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = importadexClientPortalOtpSchema.parse(req.body);
      ok(res, await importadexClientPortalService.verifyOtp(payload.identification, payload.code));
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const client = await requireClient(req);
      ok(res, {
        id: client.id,
        type: client.type,
        name: client.name,
        lastName: client.lastName,
        identification: client.identification,
        typeIdentification: client.typeIdentification,
        reviewStatus: client.reviewStatus,
      });
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },

  async listOperations(req: Request, res: Response, next: NextFunction) {
    try {
      const client = await requireClient(req);
      ok(res, await importadexClientPortalService.listOperations(client.id));
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },

  async getOperation(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const client = await requireClient(req);
      const operation = await importadexClientPortalService.getOperation(client.id, req.params.id);
      if (!operation) {
        res.status(404).json({ ok: false, message: "Operacion no encontrada" });
        return;
      }

      ok(res, operation);
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },

  async uploadAttachments(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const client = await requireClient(req);
      const body = importadexClientPortalAttachmentSchema.parse(req.body);
      const files = getUploadedFiles(req);
      const operation = await importadexClientPortalService.uploadAttachments(client, req.params.id, files, body.documentId);

      if (!operation) {
        res.status(404).json({ ok: false, message: "Operacion o documento no encontrado" });
        return;
      }

      emitClientDocumentUploaded(req, client, operation, files, body.documentId);
      ok(res, operation, 201);
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },
};
