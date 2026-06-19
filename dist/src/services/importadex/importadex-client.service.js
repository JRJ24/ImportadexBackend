"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importadexClientService = exports.ImportadexClientServiceError = void 0;
const crypto_1 = require("crypto");
const connectionDB_1 = require("../../config/connectionDB");
const encrypted_1 = require("../../helpers/encrypted");
const emailManaged_1 = require("../../helpers/emailManaged");
class ImportadexClientServiceError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.ImportadexClientServiceError = ImportadexClientServiceError;
const tokenDocumentLabels = {
    currentCommercialRegistry: "Registro Mercantil vigente",
    certificationCurrentRNCRegistration: "Certificacion de registro RNC vigente",
    copyManagerID: "Copia de cedula del gerente",
    authorizationVideo: "Video de autorizacion",
};
const tokenFileFields = Object.keys(tokenDocumentLabels);
const normalizeEmail = (email) => email.trim().toLowerCase();
const getHashSecret = () => {
    const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret)
        throw new Error("ENCRYPTION_KEY or JWT_SECRET is required for emailHash");
    return secret;
};
const createEmailHash = (email) => (0, crypto_1.createHmac)("sha256", getHashSecret()).update(normalizeEmail(email)).digest("hex");
const nullable = (value) => {
    const nextValue = value?.trim();
    return nextValue ? nextValue : null;
};
const safeDecrypt = (value) => {
    try {
        return (0, encrypted_1.decrypt)(value);
    }
    catch {
        return value;
    }
};
const stringValue = (value) => (typeof value === "string" ? value : "");
const mapToken = (row) => {
    if (!row)
        return null;
    return {
        id: stringValue(row.id),
        clientImportadex: stringValue(row.clientImportadex ?? row.clientimportadex),
        currentCommercialRegistry: stringValue(row.current_commercial_registry),
        certificationCurrentRNCRegistration: stringValue(row.certification_current_rnc_registration),
        copyManagerID: stringValue(row.copy_manager_id),
        authorizationVideo: stringValue(row.authorization_video),
    };
};
const mapClient = (row) => ({
    id: stringValue(row.id),
    type: stringValue(row.type),
    name: stringValue(row.name),
    lastName: stringValue(row.last_name) || null,
    adress: stringValue(row.adress),
    typeIdentification: stringValue(row.type_identification),
    identification: stringValue(row.identification),
    gender: stringValue(row.gender) || null,
    birthDate: stringValue(row.birth_date) || null,
    phoneHomeOffice: stringValue(row.phone_home_office),
    phonePersonal: stringValue(row.phone_personal) || null,
    email: safeDecrypt(stringValue(row.email)),
    feedBack: stringValue(row.feedBack ?? row.feedback) || null,
    commitmentDocumentUrl: stringValue(row.commitment_document_url) || null,
    commitmentDocumentName: stringValue(row.commitment_document_name) || null,
    active: Boolean(row.active),
    reviewStatus: stringValue(row.review_status) || "PENDING",
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: stringValue(row.reviewed_by) || null,
    createdAt: row.created_at ?? null,
    importadexTokenDGA: mapToken(row.importadex_token_dga ?? null),
});
const fileByField = (files, fieldName) => files.find((file) => file.fieldName === fieldName);
const getTokenFiles = (files) => {
    const mappedFiles = Object.fromEntries(tokenFileFields.map((fieldName) => [fieldName, fileByField(files, fieldName)]));
    const missing = tokenFileFields.filter((fieldName) => !mappedFiles[fieldName]);
    if (missing.length) {
        throw new ImportadexClientServiceError(400, `Faltan documentos DGA: ${missing.map((field) => tokenDocumentLabels[field]).join(", ")}`);
    }
    return mappedFiles;
};
const findClientBySecureEmail = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT id FROM importadex_clients WHERE email_hash = $1 OR email = $2 LIMIT 1`, createEmailHash(normalizedEmail), normalizedEmail);
    return rows[0] ?? null;
};
const findClientById = async (id, db = connectionDB_1.prisma) => {
    const rows = await db.$queryRawUnsafe(`SELECT c.*,
      (SELECT row_to_json(t.*) FROM "importadex_token_DGA" t WHERE t."clientImportadex" = c.id) AS importadex_token_dga
     FROM importadex_clients c
     WHERE c.id = $1`, id);
    return rows[0] ? mapClient(rows[0]) : null;
};
const auditClient = async (action, clientId, changes, db = connectionDB_1.prisma) => {
    await db.$executeRawUnsafe(`INSERT INTO importadex_audit_logs (id, action, entity, entity_id, changes)
     VALUES ($1, $2, 'client', $3, $4::jsonb)`, (0, crypto_1.randomUUID)(), action, clientId, JSON.stringify(changes ?? {}));
};
const buildEmailDocuments = (tokenFiles) => {
    if (!tokenFiles)
        return [];
    return tokenFileFields.map((fieldName) => ({
        label: tokenDocumentLabels[fieldName],
        url: tokenFiles[fieldName].url,
    }));
};
exports.importadexClientService = {
    async registerClient(payload, files) {
        const normalizedEmail = normalizeEmail(payload.email);
        const existing = await findClientBySecureEmail(normalizedEmail);
        if (existing) {
            throw new ImportadexClientServiceError(409, "Ya existe un cliente con ese correo");
        }
        const tokenFiles = payload.hasDgaToken ? null : getTokenFiles(files);
        const encryptedEmail = (0, encrypted_1.encrypt)(normalizedEmail);
        const emailHash = createEmailHash(normalizedEmail);
        const client = await connectionDB_1.prisma.$transaction(async (tx) => {
            const clientId = (0, crypto_1.randomUUID)();
            const clientRows = await tx.$queryRawUnsafe(`INSERT INTO importadex_clients (
          id, type, name, last_name, adress, type_identification, identification,
          gender, birth_date, phone_home_office, phone_personal, email, email_hash,
          "feedBack", active, review_status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, 'PENDING', CURRENT_TIMESTAMP)
        RETURNING *`, clientId, payload.type, payload.name.trim(), nullable(payload.lastName), payload.adress.trim(), payload.typeIdentification, payload.identification.trim(), nullable(payload.gender), nullable(payload.birthDate), payload.phoneHomeOffice.trim(), nullable(payload.phonePersonal), encryptedEmail, emailHash, nullable(payload.feedBack));
            if (tokenFiles) {
                await tx.$executeRawUnsafe(`INSERT INTO "importadex_token_DGA" (
            id, "clientImportadex", current_commercial_registry,
            certification_current_rnc_registration, copy_manager_id, authorization_video
          ) VALUES ($1, $2, $3, $4, $5, $6)`, (0, crypto_1.randomUUID)(), clientId, tokenFiles.currentCommercialRegistry.url, tokenFiles.certificationCurrentRNCRegistration.url, tokenFiles.copyManagerID.url, tokenFiles.authorizationVideo.url);
            }
            await auditClient("CREATE", clientId, { hasDgaToken: payload.hasDgaToken, emailHash, tokenDocuments: Boolean(tokenFiles) }, tx);
            return findClientById(clientRows[0].id, tx);
        });
        if (!client) {
            throw new ImportadexClientServiceError(500, "No se pudo registrar el cliente");
        }
        const notification = await (0, emailManaged_1.sendImportadexClientRegistrationEmails)({
            clientName: `${client.name}${client.lastName ? ` ${client.lastName}` : ""}`,
            clientEmail: client.email,
            clientType: client.type,
            identification: client.identification,
            hasDgaToken: payload.hasDgaToken,
            tokenDocuments: buildEmailDocuments(tokenFiles),
        });
        return { client, notification };
    },
    async listClients() {
        const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT c.*,
        (SELECT row_to_json(t.*) FROM "importadex_token_DGA" t WHERE t."clientImportadex" = c.id) AS importadex_token_dga
       FROM importadex_clients c
       ORDER BY c.created_at DESC`);
        return rows.map(mapClient);
    },
    async listApprovedClientOptions(q) {
        const search = q?.trim();
        const values = [];
        const clauses = [`c.active = true`, `c.review_status = 'APPROVED'`];
        if (search) {
            values.push(`%${search}%`);
            clauses.push(`(c.name ILIKE $${values.length} OR c.last_name ILIKE $${values.length} OR c.identification ILIKE $${values.length})`);
        }
        const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT c.*,
        (SELECT row_to_json(t.*) FROM "importadex_token_DGA" t WHERE t."clientImportadex" = c.id) AS importadex_token_dga
       FROM importadex_clients c
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.name ASC, c.last_name ASC
       LIMIT 50`, ...values);
        return rows.map((row) => {
            const client = mapClient(row);
            const label = `${client.name}${client.lastName ? ` ${client.lastName}` : ""}`;
            return {
                id: client.id,
                label,
                email: client.email,
                identification: client.identification,
            };
        });
    },
    async getClient(id) {
        return findClientById(id);
    },
    async reviewClient(id, status, feedBack, reviewedBy) {
        const rows = await connectionDB_1.prisma.$queryRawUnsafe(`UPDATE importadex_clients
       SET review_status = $2,
           active = $3,
           "feedBack" = COALESCE($4, "feedBack"),
           reviewed_at = CURRENT_TIMESTAMP,
           reviewed_by = $5
       WHERE id = $1
       RETURNING *`, id, status, status === "APPROVED", nullable(feedBack), reviewedBy ?? null);
        if (!rows[0])
            return null;
        await auditClient("REVIEW", id, { status, feedBack: nullable(feedBack), reviewedBy });
        return findClientById(id);
    },
    async uploadCommitmentDocument(id, file) {
        if (!file) {
            throw new ImportadexClientServiceError(400, "El documento de compromiso es requerido");
        }
        const rows = await connectionDB_1.prisma.$queryRawUnsafe(`UPDATE importadex_clients
       SET commitment_document_url = $2,
           commitment_document_name = $3
       WHERE id = $1
       RETURNING *`, id, file.url, file.originalName || file.fileName);
        if (!rows[0])
            return null;
        await auditClient("UPLOAD_COMMITMENT_DOCUMENT", id, {
            fileName: file.originalName || file.fileName,
            fileUrl: file.url,
        });
        return findClientById(id);
    },
};
