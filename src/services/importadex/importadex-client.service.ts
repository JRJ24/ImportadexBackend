import { createHmac, randomUUID } from "crypto";
import { prisma } from "../../config/connectionDB";
import { decrypt, encrypt } from "../../helpers/encrypted";
import {
  sendImportadexClientCommitmentEmail,
  sendImportadexClientRegistrationEmails,
  sendImportadexInternalNotification,
} from "../../helpers/emailManaged";
import type { ImportadexAuthUser } from "../../middlewares/importadexAdmin";
import type { UploadedFile } from "../../middlewares/processFiles";

export interface ImportadexClientRegistrationPayload {
  type: "PERSONAL" | "CORPORATIVE";
  name: string;
  lastName?: string | null;
  adress: string;
  typeIdentification: "DNI" | "RNC";
  identification: string;
  gender?: string | null;
  birthDate?: string | null;
  phoneHomeOffice: string;
  phonePersonal?: string | null;
  email: string;
  feedBack?: string | null;
  hasDgaToken: boolean;
}

type DbClient = Pick<typeof prisma, "$queryRawUnsafe" | "$executeRawUnsafe">;

type Row = Record<string, unknown>;

type TokenFileField =
  | "currentCommercialRegistry"
  | "certificationCurrentRNCRegistration"
  | "copyManagerID"
  | "authorizationVideo";

export class ImportadexClientServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const tokenDocumentLabels: Record<TokenFileField, string> = {
  currentCommercialRegistry: "Registro Mercantil vigente",
  certificationCurrentRNCRegistration: "Certificacion de registro RNC vigente",
  copyManagerID: "Copia de cedula del gerente",
  authorizationVideo: "Video de autorizacion",
};

const tokenFileFields = Object.keys(tokenDocumentLabels) as TokenFileField[];
const commitmentFileFieldNames = new Set(["commitmentDocument", "commitment", "cartaCompromiso", "file"]);

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const getHashSecret = () => {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("ENCRYPTION_KEY or JWT_SECRET is required for emailHash");
  return secret;
};

const createEmailHash = (email: string) =>
  createHmac("sha256", getHashSecret()).update(normalizeEmail(email)).digest("hex");

const nullable = (value?: string | null) => {
  const nextValue = value?.trim();
  return nextValue ? nextValue : null;
};

const safeDecrypt = (value: string) => {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
};

const stringValue = (value: unknown) => (typeof value === "string" ? value : "");

const mapToken = (row?: Row | null) => {
  if (!row) return null;

  return {
    id: stringValue(row.id),
    clientImportadex: stringValue(row.clientImportadex ?? row.clientimportadex),
    currentCommercialRegistry: stringValue(row.current_commercial_registry),
    certificationCurrentRNCRegistration: stringValue(row.certification_current_rnc_registration),
    copyManagerID: stringValue(row.copy_manager_id),
    authorizationVideo: stringValue(row.authorization_video),
  };
};

const mapClient = (row: Row) => ({
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
  importadexTokenDGA: mapToken((row.importadex_token_dga as Row | null) ?? null),
});

const fileByField = (files: UploadedFile[], fieldName: TokenFileField) =>
  files.find((file) => file.fieldName === fieldName);

const getCommitmentFile = (files: UploadedFile[]) =>
  files.find((file) => commitmentFileFieldNames.has(file.fieldName ?? ""));

const assertPdfFile = (file: UploadedFile) => {
  const isPdf = file.mimeType === "application/pdf" || file.originalName.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    throw new ImportadexClientServiceError(400, "La carta de compromiso debe ser un PDF");
  }
};

const getTokenFiles = (files: UploadedFile[]) => {
  const mappedFiles = Object.fromEntries(
    tokenFileFields.map((fieldName) => [fieldName, fileByField(files, fieldName)]),
  ) as Record<TokenFileField, UploadedFile | undefined>;

  const missing = tokenFileFields.filter((fieldName) => !mappedFiles[fieldName]);

  if (missing.length) {
    throw new ImportadexClientServiceError(
      400,
      `Faltan documentos DGA: ${missing.map((field) => tokenDocumentLabels[field]).join(", ")}`,
    );
  }

  return mappedFiles as Record<TokenFileField, UploadedFile>;
};

const findClientBySecureEmail = async (email: string) => {
  const normalizedEmail = normalizeEmail(email);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id FROM importadex_clients WHERE email_hash = $1 OR email = $2 LIMIT 1`,
    createEmailHash(normalizedEmail),
    normalizedEmail,
  );

  return rows[0] ?? null;
};

const findClientById = async (id: string, db: DbClient = prisma) => {
  const rows = await db.$queryRawUnsafe<Row[]>(
    `SELECT c.*,
      (SELECT row_to_json(t.*) FROM "importadex_token_DGA" t WHERE t."clientImportadex" = c.id) AS importadex_token_dga
     FROM importadex_clients c
     WHERE c.id = $1`,
    id,
  );

  return rows[0] ? mapClient(rows[0]) : null;
};

const auditClient = async (
  action: string,
  clientId: string,
  changes: unknown,
  db: DbClient = prisma,
  actor?: string | null,
) => {
  await db.$executeRawUnsafe(
    `INSERT INTO importadex_audit_logs (id, action, entity, entity_id, actor, changes)
     VALUES ($1, $2, 'client', $3, $4, $5::jsonb)`,
    randomUUID(),
    action,
    clientId,
    actor ?? null,
    JSON.stringify(changes ?? {}),
  );
};

const buildEmailDocuments = (tokenFiles: Record<TokenFileField, UploadedFile> | null) => {
  if (!tokenFiles) return [];

  return tokenFileFields.map((fieldName) => ({
    label: tokenDocumentLabels[fieldName],
    url: tokenFiles[fieldName].url,
  }));
};

const actorLabel = (actor?: ImportadexAuthUser | null) => actor?.name ?? actor?.email ?? null;

const clientDisplayName = (client: { name: string; lastName?: string | null }) =>
  `${client.name}${client.lastName ? ` ${client.lastName}` : ""}`;

export const importadexClientService = {
  async registerClient(payload: ImportadexClientRegistrationPayload, files: UploadedFile[]) {
    const normalizedEmail = normalizeEmail(payload.email);
    const existing = await findClientBySecureEmail(normalizedEmail);

    if (existing) {
      throw new ImportadexClientServiceError(409, "Ya existe un cliente con ese correo");
    }

    const tokenFiles = payload.hasDgaToken ? null : getTokenFiles(files);
    const encryptedEmail = encrypt(normalizedEmail);
    const emailHash = createEmailHash(normalizedEmail);

    const client = await prisma.$transaction(async (tx) => {
      const clientId = randomUUID();
      const clientRows = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO importadex_clients (
          id, type, name, last_name, adress, type_identification, identification,
          gender, birth_date, phone_home_office, phone_personal, email, email_hash,
          "feedBack", active, review_status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, 'PENDING', CURRENT_TIMESTAMP)
        RETURNING *`,
        clientId,
        payload.type,
        payload.name.trim(),
        nullable(payload.lastName),
        payload.adress.trim(),
        payload.typeIdentification,
        payload.identification.trim(),
        nullable(payload.gender),
        nullable(payload.birthDate),
        payload.phoneHomeOffice.trim(),
        nullable(payload.phonePersonal),
        encryptedEmail,
        emailHash,
        nullable(payload.feedBack),
      );

      if (tokenFiles) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "importadex_token_DGA" (
            id, "clientImportadex", current_commercial_registry,
            certification_current_rnc_registration, copy_manager_id, authorization_video
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          randomUUID(),
          clientId,
          tokenFiles.currentCommercialRegistry.url,
          tokenFiles.certificationCurrentRNCRegistration.url,
          tokenFiles.copyManagerID.url,
          tokenFiles.authorizationVideo.url,
        );
      }

      await auditClient(
        "CREATE",
        clientId,
        { hasDgaToken: payload.hasDgaToken, emailHash, tokenDocuments: Boolean(tokenFiles) },
        tx,
      );

      return findClientById(clientRows[0].id as string, tx);
    });

    if (!client) {
      throw new ImportadexClientServiceError(500, "No se pudo registrar el cliente");
    }

    const notification = await sendImportadexClientRegistrationEmails({
      clientId: client.id,
      clientName: `${client.name}${client.lastName ? ` ${client.lastName}` : ""}`,
      clientEmail: client.email,
      clientType: client.type,
      identification: client.identification,
      hasDgaToken: payload.hasDgaToken,
      tokenDocuments: buildEmailDocuments(tokenFiles),
    });

    return { client, notification };
  },

  async createClientByAdmin(payload: ImportadexClientRegistrationPayload, files: UploadedFile[], actor?: ImportadexAuthUser | null) {
    const commitmentFile = getCommitmentFile(files);
    if (!commitmentFile) {
      throw new ImportadexClientServiceError(400, "La carta de compromiso es requerida");
    }
    assertPdfFile(commitmentFile);

    const normalizedEmail = normalizeEmail(payload.email);
    const existing = await findClientBySecureEmail(normalizedEmail);

    if (existing) {
      throw new ImportadexClientServiceError(409, "Ya existe un cliente con ese correo");
    }

    const tokenFiles = payload.hasDgaToken ? null : getTokenFiles(files);
    const encryptedEmail = encrypt(normalizedEmail);
    const emailHash = createEmailHash(normalizedEmail);
    const reviewer = actorLabel(actor);

    const client = await prisma.$transaction(async (tx) => {
      const clientId = randomUUID();
      const clientRows = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO importadex_clients (
          id, type, name, last_name, adress, type_identification, identification,
          gender, birth_date, phone_home_office, phone_personal, email, email_hash,
          "feedBack", commitment_document_url, commitment_document_name, active,
          review_status, reviewed_at, reviewed_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true, 'APPROVED', CURRENT_TIMESTAMP, $17, CURRENT_TIMESTAMP)
        RETURNING *`,
        clientId,
        payload.type,
        payload.name.trim(),
        nullable(payload.lastName),
        payload.adress.trim(),
        payload.typeIdentification,
        payload.identification.trim(),
        nullable(payload.gender),
        nullable(payload.birthDate),
        payload.phoneHomeOffice.trim(),
        nullable(payload.phonePersonal),
        encryptedEmail,
        emailHash,
        nullable(payload.feedBack),
        commitmentFile.url,
        commitmentFile.originalName || commitmentFile.fileName,
        reviewer,
      );

      if (tokenFiles) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "importadex_token_DGA" (
            id, "clientImportadex", current_commercial_registry,
            certification_current_rnc_registration, copy_manager_id, authorization_video
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          randomUUID(),
          clientId,
          tokenFiles.currentCommercialRegistry.url,
          tokenFiles.certificationCurrentRNCRegistration.url,
          tokenFiles.copyManagerID.url,
          tokenFiles.authorizationVideo.url,
        );
      }

      await auditClient(
        "ADMIN_CREATE_APPROVED",
        clientId,
        {
          hasDgaToken: payload.hasDgaToken,
          emailHash,
          tokenDocuments: Boolean(tokenFiles),
          commitmentDocument: commitmentFile.url,
        },
        tx,
        reviewer,
      );

      return findClientById(clientRows[0].id as string, tx);
    });

    if (!client) {
      throw new ImportadexClientServiceError(500, "No se pudo crear el cliente");
    }

    const commitmentNotification = await sendImportadexClientCommitmentEmail({
      clientId: client.id,
      clientName: clientDisplayName(client),
      clientEmail: client.email,
      documentName: commitmentFile.originalName || commitmentFile.fileName,
      documentUrl: commitmentFile.url,
      documentType: commitmentFile.mimeType,
    });

    const internalNotification = await sendImportadexInternalNotification({
      subject: "Cliente Importadex creado por administrador",
      title: "Cliente aprobado creado por administrador",
      summary: "Un administrador creo un cliente Importadex, quedo aprobado y se envio la carta de compromiso al correo registrado.",
      rows: [
        { label: "Cliente", value: clientDisplayName(client) },
        { label: "Correo", value: client.email },
        { label: "Identificacion", value: client.identification },
        { label: "Creado por", value: reviewer },
        { label: "Carta", value: commitmentFile.originalName || commitmentFile.fileName },
      ],
    });

    return { client, notification: { commitmentNotification, internalNotification } };
  },

  async listClients() {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT c.*,
        (SELECT row_to_json(t.*) FROM "importadex_token_DGA" t WHERE t."clientImportadex" = c.id) AS importadex_token_dga
       FROM importadex_clients c
       ORDER BY c.created_at DESC`,
    );

    return rows.map(mapClient);
  },

  async listApprovedClientOptions(q?: string) {
    const search = q?.trim();
    const values: unknown[] = [];
    const clauses = [`c.active = true`, `c.review_status = 'APPROVED'`];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(c.name ILIKE $${values.length} OR c.last_name ILIKE $${values.length} OR c.identification ILIKE $${values.length})`);
    }

    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT c.*,
        (SELECT row_to_json(t.*) FROM "importadex_token_DGA" t WHERE t."clientImportadex" = c.id) AS importadex_token_dga
       FROM importadex_clients c
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.name ASC, c.last_name ASC
       LIMIT 50`,
      ...values,
    );

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

  async getClient(id: string) {
    return findClientById(id);
  },

  async reviewClient(id: string, status: "APPROVED" | "REJECTED", feedBack?: string | null, reviewedBy?: string) {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE importadex_clients
       SET review_status = $2,
           active = $3,
           "feedBack" = COALESCE($4, "feedBack"),
           reviewed_at = CURRENT_TIMESTAMP,
           reviewed_by = $5
       WHERE id = $1
       RETURNING *`,
      id,
      status,
      status === "APPROVED",
      nullable(feedBack),
      reviewedBy ?? null,
    );

    if (!rows[0]) return null;

    await auditClient("REVIEW", id, { status, feedBack: nullable(feedBack), reviewedBy }, prisma, reviewedBy);
    return findClientById(id);
  },

  async uploadCommitmentDocument(id: string, file?: UploadedFile, actor?: ImportadexAuthUser | null) {
    if (!file) {
      throw new ImportadexClientServiceError(400, "El documento de compromiso es requerido");
    }
    assertPdfFile(file);

    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE importadex_clients
       SET commitment_document_url = $2,
           commitment_document_name = $3
       WHERE id = $1
       RETURNING *`,
      id,
      file.url,
      file.originalName || file.fileName,
    );

    if (!rows[0]) return null;

    await auditClient("UPLOAD_COMMITMENT_DOCUMENT", id, {
      fileName: file.originalName || file.fileName,
      fileUrl: file.url,
    }, prisma, actorLabel(actor));

    const client = await findClientById(id);
    if (client) {
      await sendImportadexClientCommitmentEmail({
        clientId: client.id,
        clientName: clientDisplayName(client),
        clientEmail: client.email,
        documentName: file.originalName || file.fileName,
        documentUrl: file.url,
        documentType: file.mimeType,
      });
    }

    return client;
  },
};
