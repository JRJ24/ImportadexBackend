"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importadexClientPortalService = exports.ImportadexClientPortalError = void 0;
const crypto_1 = require("crypto");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connectionDB_1 = require("../../config/connectionDB");
const emailManaged_1 = require("../../helpers/emailManaged");
const encrypted_1 = require("../../helpers/encrypted");
const importadex_service_1 = require("./importadex.service");
const importadex_client_service_1 = require("./importadex-client.service");
class ImportadexClientPortalError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.ImportadexClientPortalError = ImportadexClientPortalError;
const otpExpiresInMinutes = Number(process.env.IMPORTADEX_CLIENT_OTP_MINUTES || 10);
const maxOtpAttempts = Number(process.env.IMPORTADEX_CLIENT_OTP_ATTEMPTS || 5);
const stringValue = (value) => (typeof value === "string" ? value : "");
const safeDecrypt = (value) => {
    try {
        return (0, encrypted_1.decrypt)(value);
    }
    catch {
        return value;
    }
};
const getJwtSecret = () => {
    const secret = process.env.IMPORTADEX_CLIENT_JWT_SECRET ||
        process.env.JWT_SECRET ||
        process.env.MIREX_JWT_SECRET;
    if (!secret)
        throw new Error("IMPORTADEX_CLIENT_JWT_SECRET, JWT_SECRET or MIREX_JWT_SECRET is required");
    return secret;
};
const clientDisplayName = (client) => `${client.name}${client.lastName ? ` ${client.lastName}` : ""}`;
const maskEmail = (email) => {
    const [local = "", domain = ""] = email.split("@");
    const visible = local.length <= 2 ? local : local.slice(0, 2);
    return `${visible}***@${domain || "correo"}`;
};
const mapClient = (row) => ({
    id: stringValue(row.id),
    type: stringValue(row.type),
    name: stringValue(row.name),
    lastName: stringValue(row.last_name) || null,
    identification: stringValue(row.identification),
    typeIdentification: stringValue(row.type_identification),
    email: safeDecrypt(stringValue(row.email)),
    reviewStatus: stringValue(row.review_status) || "PENDING",
    active: Boolean(row.active),
});
const toPublicClient = (client) => ({
    id: client.id,
    type: client.type,
    name: client.name,
    lastName: client.lastName,
    identification: client.identification,
    typeIdentification: client.typeIdentification,
    emailMasked: maskEmail(client.email),
    reviewStatus: client.reviewStatus,
});
const signClientToken = (clientId) => jsonwebtoken_1.default.sign({ data: { clientId, type: "IMPORTADEX_CLIENT_PORTAL" } }, getJwtSecret(), { algorithm: "HS256", expiresIn: "8h" });
const verifyClientToken = (token) => jsonwebtoken_1.default.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
const hashOtp = (clientId, code) => (0, crypto_1.createHmac)("sha256", getJwtSecret()).update(`${clientId}:${code}`).digest("hex");
const generateOtp = () => String((0, crypto_1.randomInt)(100000, 1000000));
const assertApprovedClient = (client) => {
    if (client.reviewStatus !== "APPROVED" || !client.active) {
        throw new ImportadexClientPortalError(403, client.reviewStatus === "REJECTED"
            ? "Tu registro fue rechazado. Contacta a Importadex para mas informacion."
            : "Tu registro aun esta en revision. Te avisaremos cuando este aprobado.");
    }
};
async function findClientByIdentification(identification) {
    const normalizedIdentification = (0, importadex_client_service_1.normalizeIdentification)(identification);
    if (normalizedIdentification.length < 3) {
        throw new ImportadexClientPortalError(400, "Identificacion invalida");
    }
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT *
     FROM importadex_clients
     WHERE regexp_replace(identification, '[^0-9]', '', 'g') = $1
     ORDER BY CASE WHEN review_status = 'APPROVED' THEN 0 ELSE 1 END, created_at DESC
     LIMIT 1`, normalizedIdentification);
    return rows[0] ? mapClient(rows[0]) : null;
}
async function findApprovedClientById(id) {
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT *
     FROM importadex_clients
     WHERE id = $1
     LIMIT 1`, id);
    const client = rows[0] ? mapClient(rows[0]) : null;
    if (client)
        assertApprovedClient(client);
    return client;
}
async function storeOtp(client, code) {
    await connectionDB_1.prisma.$executeRawUnsafe(`DELETE FROM importadex_client_portal_otps
     WHERE client_id = $1 AND (expires_at < CURRENT_TIMESTAMP OR used_at IS NOT NULL)`, client.id);
    const expiresAt = new Date(Date.now() + otpExpiresInMinutes * 60_000);
    await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_client_portal_otps (id, client_id, code_hash, attempts, expires_at, created_at)
     VALUES ($1, $2, $3, 0, $4, CURRENT_TIMESTAMP)`, (0, crypto_1.randomUUID)(), client.id, hashOtp(client.id, code), expiresAt);
}
async function resolveClientOperationId(clientId, operationIdOrCode) {
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT id
     FROM importadex_operations
     WHERE client_id = $1
       AND is_active = true
       AND status NOT IN ('CLOSED', 'CANCELLED')
       AND (id = $2 OR code = $2)
     LIMIT 1`, clientId, operationIdOrCode);
    return rows[0]?.id ?? null;
}
async function getDocumentName(operationId, documentId) {
    if (!documentId)
        return null;
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT name FROM importadex_documents WHERE id = $1 AND operation_id = $2 LIMIT 1`, documentId, operationId);
    return rows[0]?.name ?? null;
}
function actorFromClient(client) {
    return {
        id: client.id,
        email: client.email,
        name: `Cliente ${clientDisplayName(client)}`,
        role: "IMPORTADEX_CLIENTE",
    };
}
function operationText(operation, key) {
    const record = operation && typeof operation === "object" ? operation : {};
    const value = record[key];
    return value === null || value === undefined ? null : String(value);
}
function queuePortalEmailTask(label, task) {
    void task().catch((error) => {
        console.error("Importadex client portal email background task failed", {
            label,
            message: error instanceof Error ? error.message : "Email background task failed",
        });
    });
}
exports.importadexClientPortalService = {
    async requestLogin(identification) {
        const client = await findClientByIdentification(identification);
        if (!client) {
            throw new ImportadexClientPortalError(404, "No encontramos un cliente con esa identificacion.");
        }
        assertApprovedClient(client);
        const code = generateOtp();
        await storeOtp(client, code);
        queuePortalEmailTask("client-portal-otp", () => (0, emailManaged_1.sendImportadexClientPortalOtpEmail)({
            clientId: client.id,
            clientName: clientDisplayName(client),
            clientEmail: client.email,
            identification: client.identification,
            code,
            expiresInMinutes: otpExpiresInMinutes,
        }));
        return {
            client: toPublicClient(client),
            emailMasked: maskEmail(client.email),
            expiresInMinutes: otpExpiresInMinutes,
            notification: { queued: true },
        };
    },
    async verifyOtp(identification, code) {
        const client = await findClientByIdentification(identification);
        if (!client) {
            throw new ImportadexClientPortalError(404, "No encontramos un cliente con esa identificacion.");
        }
        assertApprovedClient(client);
        const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT id, code_hash, attempts, expires_at
       FROM importadex_client_portal_otps
       WHERE client_id = $1 AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`, client.id);
        const otp = rows[0];
        const expiresAt = otp?.expires_at instanceof Date ? otp.expires_at : new Date(otp?.expires_at ?? 0);
        if (!otp || expiresAt.getTime() < Date.now()) {
            throw new ImportadexClientPortalError(400, "El codigo expiro. Solicita uno nuevo.");
        }
        if (otp.attempts >= maxOtpAttempts) {
            throw new ImportadexClientPortalError(429, "Demasiados intentos. Solicita un codigo nuevo.");
        }
        if (otp.code_hash !== hashOtp(client.id, code)) {
            await connectionDB_1.prisma.$executeRawUnsafe(`UPDATE importadex_client_portal_otps SET attempts = attempts + 1 WHERE id = $1`, otp.id);
            throw new ImportadexClientPortalError(400, "Codigo incorrecto.");
        }
        await connectionDB_1.prisma.$executeRawUnsafe(`UPDATE importadex_client_portal_otps SET used_at = CURRENT_TIMESTAMP WHERE id = $1`, otp.id);
        return {
            token: signClientToken(client.id),
            client: toPublicClient(client),
        };
    },
    async authenticate(token) {
        if (!token)
            throw new ImportadexClientPortalError(401, "Unauthorized");
        try {
            const decoded = verifyClientToken(token);
            if (decoded.data?.type !== "IMPORTADEX_CLIENT_PORTAL" || !decoded.data.clientId) {
                throw new Error("Invalid client token");
            }
            const client = await findApprovedClientById(decoded.data.clientId);
            if (!client)
                throw new Error("Client not found");
            return client;
        }
        catch {
            throw new ImportadexClientPortalError(401, "Unauthorized");
        }
    },
    async listOperations(clientId) {
        const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT id
       FROM importadex_operations
       WHERE client_id = $1
         AND is_active = true
         AND status NOT IN ('CLOSED', 'CANCELLED')
       ORDER BY created_at DESC`, clientId);
        const operations = await Promise.all(rows.map((row) => importadex_service_1.importadexService.getOperation(row.id)));
        return operations.filter(Boolean);
    },
    async getOperation(clientId, operationIdOrCode) {
        const operationId = await resolveClientOperationId(clientId, operationIdOrCode);
        if (!operationId)
            return null;
        return importadex_service_1.importadexService.getOperation(operationId);
    },
    async uploadAttachments(client, operationIdOrCode, files, documentId) {
        if (!files.length) {
            throw new ImportadexClientPortalError(400, "At least one file is required");
        }
        const operationId = await resolveClientOperationId(client.id, operationIdOrCode);
        if (!operationId)
            return null;
        const documentName = await getDocumentName(operationId, documentId);
        if (documentId && !documentName)
            return null;
        const operation = await importadex_service_1.importadexService.createAttachments(operationId, files, documentId, actorFromClient(client));
        if (!operation)
            return null;
        queuePortalEmailTask("client-document-upload", () => (0, emailManaged_1.sendImportadexClientDocumentUploadEmail)({
            operationId,
            clientId: client.id,
            clientName: clientDisplayName(client),
            clientEmail: client.email,
            operationCode: operationText(operation, "code") ?? operationId,
            documentName,
            fileNames: files.map((file) => file.originalName || file.fileName),
        }));
        return operation;
    },
};
