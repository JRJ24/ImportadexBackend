"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importadexClientPortalController = void 0;
const zod_1 = require("zod");
const importadex_client_portal_service_1 = require("../../services/importadex/importadex-client-portal.service");
const importadex_schemas_1 = require("../../validators/importadex.schemas");
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
const getUploadedFiles = (req) => {
    const body = req.body;
    return Array.isArray(body.uploadedFiles) ? body.uploadedFiles : [];
};
const getClientToken = (req) => {
    const clientToken = req.headers["x-client-access-token"];
    if (typeof clientToken === "string")
        return clientToken;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer "))
        return authHeader.split(" ")[1];
    return undefined;
};
const handleError = (res, error) => {
    if (error instanceof zod_1.z.ZodError) {
        res.status(400).json({ ok: false, message: "Datos invalidos", errors: error.flatten().fieldErrors });
        return true;
    }
    if (error instanceof importadex_client_portal_service_1.ImportadexClientPortalError) {
        res.status(error.status).json({ ok: false, message: error.message });
        return true;
    }
    return false;
};
async function requireClient(req) {
    return importadex_client_portal_service_1.importadexClientPortalService.authenticate(getClientToken(req));
}
function emitClientDocumentUploaded(req, client, operation, files, documentId) {
    const io = req.app.get("socketio");
    if (!io)
        return;
    const record = operation && typeof operation === "object" ? operation : {};
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
exports.importadexClientPortalController = {
    async requestLogin(req, res, next) {
        try {
            const payload = importadex_schemas_1.importadexClientPortalLoginSchema.parse(req.body);
            ok(res, await importadex_client_portal_service_1.importadexClientPortalService.requestLogin(payload.identification), 201);
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
    async verifyOtp(req, res, next) {
        try {
            const payload = importadex_schemas_1.importadexClientPortalOtpSchema.parse(req.body);
            ok(res, await importadex_client_portal_service_1.importadexClientPortalService.verifyOtp(payload.identification, payload.code));
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
    async me(req, res, next) {
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
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
    async listOperations(req, res, next) {
        try {
            const client = await requireClient(req);
            ok(res, await importadex_client_portal_service_1.importadexClientPortalService.listOperations(client.id));
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
    async getOperation(req, res, next) {
        try {
            const client = await requireClient(req);
            const operation = await importadex_client_portal_service_1.importadexClientPortalService.getOperation(client.id, req.params.id);
            if (!operation) {
                res.status(404).json({ ok: false, message: "Operacion no encontrada" });
                return;
            }
            ok(res, operation);
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
    async uploadAttachments(req, res, next) {
        try {
            const client = await requireClient(req);
            const body = importadex_schemas_1.importadexClientPortalAttachmentSchema.parse(req.body);
            const files = getUploadedFiles(req);
            const operation = await importadex_client_portal_service_1.importadexClientPortalService.uploadAttachments(client, req.params.id, files, body.documentId);
            if (!operation) {
                res.status(404).json({ ok: false, message: "Operacion o documento no encontrado" });
                return;
            }
            emitClientDocumentUploaded(req, client, operation, files, body.documentId);
            ok(res, operation, 201);
        }
        catch (error) {
            if (!handleError(res, error))
                next(error);
        }
    },
};
