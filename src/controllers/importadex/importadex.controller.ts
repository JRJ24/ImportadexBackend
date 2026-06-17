import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ImportadexServiceError, importadexService, type TableKey } from "../../services/importadex/importadex.service";
import type { UploadedFile } from "../../middlewares/processFiles";
import {
  attachmentSchema,
  importadexCatalogOptionSchema,
  commentSchema,
  containerSchema,
  customsFileSchema,
  documentSchema,
  eventSchema,
  incidentSchema,
  operationPatchSchema,
  operationSchema,
  patchSchemas,
  statusSchema,
} from "../../validators/importadex.schemas";

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ ok: true, data });

const parse = (schema: ZodType, data: unknown) => schema.parse(data) as Record<string, unknown>;

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");

const handleServiceError = (res: Response, error: unknown) => {
  if (!(error instanceof ImportadexServiceError)) return false;

  res.status(error.status).json({ ok: false, message: error.message });
  return true;
};

const getUploadedFiles = (req: Request) => {
  const body = req.body as {
    imageUrls?: string[] | string;
    uploadedFiles?: UploadedFile[];
  };

  if (Array.isArray(body.uploadedFiles)) {
    return body.uploadedFiles;
  }

  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls
    : body.imageUrls
      ? [body.imageUrls]
      : [];

  return imageUrls.map((url, index) => ({
    key: url,
    fileName: `attachment-${index + 1}`,
    originalName: `attachment-${index + 1}`,
    mimeType: "application/octet-stream",
    size: 0,
    url,
  }));
};

export const importadexController = {
  async listOperations(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await importadexService.listOperations({
        q: req.query.q?.toString(),
        status: req.query.status?.toString(),
        mode: req.query.mode?.toString(),
      });
      ok(res, data);
    } catch (error) {
      next(error);
    }
  },

  async createOperation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await importadexService.createOperation(parse(operationSchema, req.body));
      ok(res, data, 201);
    } catch (error) {
      if (handleServiceError(res, error)) return;
      next(error);
    }
  },

  async getOperation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await importadexService.getOperation(param(req.params.id));
      if (!data) {
        res.status(404).json({ ok: false, message: "Operation not found" });
        return;
      }
      ok(res, data);
    } catch (error) {
      next(error);
    }
  },

  async updateOperation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await importadexService.updateOperation(param(req.params.id), parse(operationPatchSchema, req.body));
      if (!data) {
        res.status(404).json({ ok: false, message: "Operation not found" });
        return;
      }
      ok(res, data);
    } catch (error) {
      next(error);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const body = parse(statusSchema, req.body);
      const data = await importadexService.updateStatus(param(req.params.id), String(body.status), body.note?.toString());
      ok(res, data);
    } catch (error) {
      next(error);
    }
  },

  async listEvents(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexService.listEvents(param(req.params.id)));
    } catch (error) {
      next(error);
    }
  },

  async createEvent(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexService.createEvent(param(req.params.id), parse(eventSchema, req.body)), 201);
    } catch (error) {
      next(error);
    }
  },

  async listComments(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexService.listComments(param(req.params.id)));
    } catch (error) {
      next(error);
    }
  },

  async createComment(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexService.createComment(param(req.params.id), parse(commentSchema, req.body)), 201);
    } catch (error) {
      next(error);
    }
  },

  async listOperationAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexService.listAttachments(param(req.params.id)));
    } catch (error) {
      next(error);
    }
  },

  async uploadOperationAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as { operationId?: string; documentId?: string };
      const operationId = param(req.params.id) || String(body.operationId ?? "");
      const documentId = body.documentId ? String(body.documentId) : null;
      const files = getUploadedFiles(req);

      if (!operationId) {
        res.status(400).json({ ok: false, message: "operationId is required" });
        return;
      }

      if (!files.length) {
        res.status(400).json({ ok: false, message: "At least one file is required" });
        return;
      }

      const data = await importadexService.createAttachments(operationId, files, documentId);
      if (!data) {
        res.status(404).json({ ok: false, message: "Operation not found" });
        return;
      }

      ok(res, data, 201);
    } catch (error) {
      next(error);
    }
  },

  tableHandlers(key: TableKey) {
    const schemas = {
      containers: containerSchema,
      "customs-files": customsFileSchema,
      incidents: incidentSchema,
      documents: documentSchema,
      attachments: attachmentSchema,
    };

    return {
      list: async (_req: Request, res: Response, next: NextFunction) => {
        try {
          ok(res, await importadexService.listTable(key));
        } catch (error) {
          next(error);
        }
      },
      create: async (req: Request, res: Response, next: NextFunction) => {
        try {
          ok(res, await importadexService.createTable(key, parse(schemas[key], req.body)), 201);
        } catch (error) {
          if (handleServiceError(res, error)) return;
          next(error);
        }
      },
      update: async (req: Request, res: Response, next: NextFunction) => {
        try {
          ok(res, await importadexService.updateTable(key, param(req.params.id), parse(patchSchemas[key], req.body)));
        } catch (error) {
          next(error);
        }
      },
    };
  },

  async catalogs(_req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexService.catalogs());
    } catch (error) {
      next(error);
    }
  },

  async createCatalogOption(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await importadexService.createCatalogOption(importadexCatalogOptionSchema.parse(req.body));
      ok(res, data, 201);
    } catch (error) {
      if (handleServiceError(res, error)) return;
      next(error);
    }
  },

  async dashboard(_req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexService.dashboard());
    } catch (error) {
      next(error);
    }
  },

  async reports(_req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await importadexService.reports());
    } catch (error) {
      next(error);
    }
  },
};
