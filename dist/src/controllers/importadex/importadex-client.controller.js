"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importadexClientController = void 0;
const zod_1 = require("zod");
const importadex_client_service_1 = require("../../services/importadex/importadex-client.service");
const importadex_schemas_1 = require("../../validators/importadex.schemas");
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
const getUploadedFiles = (req) => {
    const body = req.body;
    return Array.isArray(body.uploadedFiles) ? body.uploadedFiles : [];
};
const handleError = (res, error) => {
    if (error instanceof zod_1.z.ZodError) {
        res.status(400).json({ ok: false, message: "Datos invalidos", errors: error.flatten().fieldErrors });
        return true;
    }
    if (error instanceof importadex_client_service_1.ImportadexClientServiceError) {
        res.status(error.status).json({ ok: false, message: error.message });
        return true;
    }
    return false;
};
exports.importadexClientController = {
    async register(req, res, next) {
        try {
            const payload = importadex_schemas_1.importadexClientRegisterSchema.parse(req.body);
            const data = await importadex_client_service_1.importadexClientService.registerClient(payload, getUploadedFiles(req));
            ok(res, data, 201);
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
    async list(req, res, next) {
        try {
            ok(res, await importadex_client_service_1.importadexClientService.listClients());
        }
        catch (error) {
            next(error);
        }
    },
    async listApprovedOptions(req, res, next) {
        try {
            ok(res, await importadex_client_service_1.importadexClientService.listApprovedClientOptions(req.query.q?.toString()));
        }
        catch (error) {
            next(error);
        }
    },
    async get(req, res, next) {
        try {
            const client = await importadex_client_service_1.importadexClientService.getClient(req.params.id);
            if (!client) {
                res.status(404).json({ ok: false, message: "Cliente no encontrado" });
                return;
            }
            ok(res, client);
        }
        catch (error) {
            next(error);
        }
    },
    async approve(req, res, next) {
        try {
            const payload = importadex_schemas_1.importadexClientReviewSchema.parse(req.body);
            const client = await importadex_client_service_1.importadexClientService.reviewClient(req.params.id, "APPROVED", payload.feedBack);
            if (!client) {
                res.status(404).json({ ok: false, message: "Cliente no encontrado" });
                return;
            }
            ok(res, client);
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
    async reject(req, res, next) {
        try {
            const payload = importadex_schemas_1.importadexClientReviewSchema.parse(req.body);
            const client = await importadex_client_service_1.importadexClientService.reviewClient(req.params.id, "REJECTED", payload.feedBack);
            if (!client) {
                res.status(404).json({ ok: false, message: "Cliente no encontrado" });
                return;
            }
            ok(res, client);
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
    async uploadCommitment(req, res, next) {
        try {
            const client = await importadex_client_service_1.importadexClientService.uploadCommitmentDocument(req.params.id, getUploadedFiles(req)[0]);
            if (!client) {
                res.status(404).json({ ok: false, message: "Cliente no encontrado" });
                return;
            }
            ok(res, client);
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
};
