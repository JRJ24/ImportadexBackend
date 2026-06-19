import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { UploadedFile } from "../../middlewares/processFiles";
import {
  ImportadexClientServiceError,
  importadexClientService,
} from "../../services/importadex/importadex-client.service";
import {
  importadexClientRegisterSchema,
  importadexClientReviewSchema,
} from "../../validators/importadex.schemas";

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ ok: true, data });

const getUploadedFiles = (req: Request) => {
  const body = req.body as { uploadedFiles?: UploadedFile[] };
  return Array.isArray(body.uploadedFiles) ? body.uploadedFiles : [];
};

const handleError = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ ok: false, message: "Datos invalidos", errors: error.flatten().fieldErrors });
    return true;
  }

  if (error instanceof ImportadexClientServiceError) {
    res.status(error.status).json({ ok: false, message: error.message });
    return true;
  }

  return false;
};

export const importadexClientController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = importadexClientRegisterSchema.parse(req.body);
      const data = await importadexClientService.registerClient(payload, getUploadedFiles(req));
      ok(res, data, 201);
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexClientService.listClients());
    } catch (error) {
      next(error);
    }
  },

  async listApprovedOptions(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexClientService.listApprovedClientOptions(req.query.q?.toString()));
    } catch (error) {
      next(error);
    }
  },

  async get(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const client = await importadexClientService.getClient(req.params.id);
      if (!client) {
        res.status(404).json({ ok: false, message: "Cliente no encontrado" });
        return;
      }

      ok(res, client);
    } catch (error) {
      next(error);
    }
  },

  async approve(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const payload = importadexClientReviewSchema.parse(req.body);
      const client = await importadexClientService.reviewClient(req.params.id, "APPROVED", payload.feedBack);
      if (!client) {
        res.status(404).json({ ok: false, message: "Cliente no encontrado" });
        return;
      }

      ok(res, client);
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },

  async reject(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const payload = importadexClientReviewSchema.parse(req.body);
      const client = await importadexClientService.reviewClient(req.params.id, "REJECTED", payload.feedBack);
      if (!client) {
        res.status(404).json({ ok: false, message: "Cliente no encontrado" });
        return;
      }

      ok(res, client);
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },

  async uploadCommitment(req: Request<{ id: string }>, res: Response, next: NextFunction) {
    try {
      const client = await importadexClientService.uploadCommitmentDocument(req.params.id, getUploadedFiles(req)[0]);
      if (!client) {
        res.status(404).json({ ok: false, message: "Cliente no encontrado" });
        return;
      }

      ok(res, client);
    } catch (error) {
      if (!handleError(res, error)) next(error);
    }
  },
};
