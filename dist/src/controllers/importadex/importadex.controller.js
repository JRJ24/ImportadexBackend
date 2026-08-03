"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importadexController = void 0;
const importadex_service_1 = require("../../services/importadex/importadex.service");
const importadex_schemas_1 = require("../../validators/importadex.schemas");
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
const parse = (schema, data) => schema.parse(data);
const param = (value) => (Array.isArray(value) ? value[0] : value ?? "");
const handleServiceError = (res, error) => {
    if (!(error instanceof importadex_service_1.ImportadexServiceError))
        return false;
    res.status(error.status).json({ ok: false, message: error.message });
    return true;
};
const getUploadedFiles = (req) => {
    const body = req.body;
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
exports.importadexController = {
    async listOperations(req, res, next) {
        try {
            const data = await importadex_service_1.importadexService.listOperations({
                q: req.query.q?.toString(),
                status: req.query.status?.toString(),
                mode: req.query.mode?.toString(),
            });
            ok(res, data);
        }
        catch (error) {
            next(error);
        }
    },
    async createOperation(req, res, next) {
        try {
            const data = await importadex_service_1.importadexService.createOperation(parse(importadex_schemas_1.operationSchema, req.body), req.importadexUser);
            ok(res, data, 201);
        }
        catch (error) {
            if (handleServiceError(res, error))
                return;
            next(error);
        }
    },
    async getOperation(req, res, next) {
        try {
            const data = await importadex_service_1.importadexService.getOperation(param(req.params.id));
            if (!data) {
                res.status(404).json({ ok: false, message: "Operation not found" });
                return;
            }
            ok(res, data);
        }
        catch (error) {
            next(error);
        }
    },
    async updateOperation(req, res, next) {
        try {
            const data = await importadex_service_1.importadexService.updateOperation(param(req.params.id), parse(importadex_schemas_1.operationPatchSchema, req.body), req.importadexUser);
            if (!data) {
                res.status(404).json({ ok: false, message: "Operation not found" });
                return;
            }
            ok(res, data);
        }
        catch (error) {
            next(error);
        }
    },
    async updateStatus(req, res, next) {
        try {
            const body = parse(importadex_schemas_1.statusSchema, req.body);
            const data = await importadex_service_1.importadexService.updateStatus(param(req.params.id), String(body.status), body.note?.toString(), req.importadexUser);
            ok(res, data);
        }
        catch (error) {
            next(error);
        }
    },
    async listEvents(req, res, next) {
        try {
            ok(res, await importadex_service_1.importadexService.listEvents(param(req.params.id)));
        }
        catch (error) {
            next(error);
        }
    },
    async createEvent(req, res, next) {
        try {
            ok(res, await importadex_service_1.importadexService.createEvent(param(req.params.id), parse(importadex_schemas_1.eventSchema, req.body), req.importadexUser), 201);
        }
        catch (error) {
            next(error);
        }
    },
    async listComments(req, res, next) {
        try {
            ok(res, await importadex_service_1.importadexService.listComments(param(req.params.id)));
        }
        catch (error) {
            next(error);
        }
    },
    async createComment(req, res, next) {
        try {
            ok(res, await importadex_service_1.importadexService.createComment(param(req.params.id), parse(importadex_schemas_1.commentSchema, req.body)), 201);
        }
        catch (error) {
            next(error);
        }
    },
    async listOperationAttachments(req, res, next) {
        try {
            ok(res, await importadex_service_1.importadexService.listAttachments(param(req.params.id)));
        }
        catch (error) {
            next(error);
        }
    },
    async uploadOperationAttachments(req, res, next) {
        try {
            const body = req.body;
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
            const data = await importadex_service_1.importadexService.createAttachments(operationId, files, documentId, req.importadexUser);
            if (!data) {
                res.status(404).json({ ok: false, message: "Operation not found" });
                return;
            }
            ok(res, data, 201);
        }
        catch (error) {
            next(error);
        }
    },
    tableHandlers(key) {
        const schemas = {
            containers: importadex_schemas_1.containerSchema,
            "customs-files": importadex_schemas_1.customsFileSchema,
            incidents: importadex_schemas_1.incidentSchema,
            documents: importadex_schemas_1.documentSchema,
            attachments: importadex_schemas_1.attachmentSchema,
        };
        return {
            list: async (_req, res, next) => {
                try {
                    ok(res, await importadex_service_1.importadexService.listTable(key));
                }
                catch (error) {
                    next(error);
                }
            },
            create: async (req, res, next) => {
                try {
                    ok(res, await importadex_service_1.importadexService.createTable(key, parse(schemas[key], req.body), req.importadexUser), 201);
                }
                catch (error) {
                    if (handleServiceError(res, error))
                        return;
                    next(error);
                }
            },
            update: async (req, res, next) => {
                try {
                    ok(res, await importadex_service_1.importadexService.updateTable(key, param(req.params.id), parse(importadex_schemas_1.patchSchemas[key], req.body), req.importadexUser));
                }
                catch (error) {
                    next(error);
                }
            },
        };
    },
    async catalogs(_req, res, next) {
        try {
            ok(res, await importadex_service_1.importadexService.catalogs());
        }
        catch (error) {
            next(error);
        }
    },
    async createCatalogOption(req, res, next) {
        try {
            const data = await importadex_service_1.importadexService.createCatalogOption(importadex_schemas_1.importadexCatalogOptionSchema.parse(req.body));
            ok(res, data, 201);
        }
        catch (error) {
            if (handleServiceError(res, error))
                return;
            next(error);
        }
    },
    async dashboard(_req, res, next) {
        try {
            ok(res, await importadex_service_1.importadexService.dashboard());
        }
        catch (error) {
            next(error);
        }
    },
    async reports(_req, res, next) {
        try {
            ok(res, await importadex_service_1.importadexService.reports());
        }
        catch (error) {
            next(error);
        }
    },
};
