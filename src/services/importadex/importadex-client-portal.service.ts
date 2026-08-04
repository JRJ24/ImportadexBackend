import { createHmac, randomInt, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/connectionDB";
import {
  sendImportadexClientDocumentUploadEmail,
  sendImportadexClientPortalOtpEmail,
} from "../../helpers/emailManaged";
import { decrypt } from "../../helpers/encrypted";
import type { ImportadexAuthUser } from "../../middlewares/importadexAdmin";
import type { UploadedFile } from "../../middlewares/processFiles";
import { importadexService } from "./importadex.service";
import { normalizeIdentification } from "./importadex-client.service";

type Row = Record<string, unknown>;

interface ClientPortalToken extends jwt.JwtPayload {
  data?: {
    clientId?: string;
    type?: string;
  };
}

export interface ImportadexPortalClient {
  id: string;
  type: string;
  name: string;
  lastName: string | null;
  identification: string;
  typeIdentification: string;
  email: string;
  reviewStatus: string;
  active: boolean;
}

export class ImportadexClientPortalError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const otpExpiresInMinutes = Number(process.env.IMPORTADEX_CLIENT_OTP_MINUTES || 10);
const maxOtpAttempts = Number(process.env.IMPORTADEX_CLIENT_OTP_ATTEMPTS || 5);

const stringValue = (value: unknown) => (typeof value === "string" ? value : "");

const safeDecrypt = (value: string) => {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
};

const getJwtSecret = () => {
  const secret =
    process.env.IMPORTADEX_CLIENT_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.MIREX_JWT_SECRET;

  if (!secret) throw new Error("IMPORTADEX_CLIENT_JWT_SECRET, JWT_SECRET or MIREX_JWT_SECRET is required");
  return secret;
};

const clientDisplayName = (client: Pick<ImportadexPortalClient, "name" | "lastName">) =>
  `${client.name}${client.lastName ? ` ${client.lastName}` : ""}`;

const maskEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.length <= 2 ? local : local.slice(0, 2);
  return `${visible}***@${domain || "correo"}`;
};

const mapClient = (row: Row): ImportadexPortalClient => ({
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

const toPublicClient = (client: ImportadexPortalClient) => ({
  id: client.id,
  type: client.type,
  name: client.name,
  lastName: client.lastName,
  identification: client.identification,
  typeIdentification: client.typeIdentification,
  emailMasked: maskEmail(client.email),
  reviewStatus: client.reviewStatus,
});

const signClientToken = (clientId: string) =>
  jwt.sign(
    { data: { clientId, type: "IMPORTADEX_CLIENT_PORTAL" } },
    getJwtSecret(),
    { algorithm: "HS256", expiresIn: "8h" },
  );

const verifyClientToken = (token: string) =>
  jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as ClientPortalToken;

const hashOtp = (clientId: string, code: string) =>
  createHmac("sha256", getJwtSecret()).update(`${clientId}:${code}`).digest("hex");

const generateOtp = () => String(randomInt(100000, 1000000));

const assertApprovedClient = (client: ImportadexPortalClient) => {
  if (client.reviewStatus !== "APPROVED" || !client.active) {
    throw new ImportadexClientPortalError(
      403,
      client.reviewStatus === "REJECTED"
        ? "Tu registro fue rechazado. Contacta a Importadex para mas informacion."
        : "Tu registro aun esta en revision. Te avisaremos cuando este aprobado.",
    );
  }
};

async function findClientByIdentification(identification: string) {
  const normalizedIdentification = normalizeIdentification(identification);
  if (normalizedIdentification.length < 3) {
    throw new ImportadexClientPortalError(400, "Identificacion invalida");
  }

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT *
     FROM importadex_clients
     WHERE regexp_replace(identification, '[^0-9]', '', 'g') = $1
     ORDER BY CASE WHEN review_status = 'APPROVED' THEN 0 ELSE 1 END, created_at DESC
     LIMIT 1`,
    normalizedIdentification,
  );

  return rows[0] ? mapClient(rows[0]) : null;
}

async function findApprovedClientById(id: string) {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT *
     FROM importadex_clients
     WHERE id = $1
     LIMIT 1`,
    id,
  );

  const client = rows[0] ? mapClient(rows[0]) : null;
  if (client) assertApprovedClient(client);
  return client;
}

async function storeOtp(client: ImportadexPortalClient, code: string) {
  await prisma.$executeRawUnsafe(
    `DELETE FROM importadex_client_portal_otps
     WHERE client_id = $1 AND (expires_at < CURRENT_TIMESTAMP OR used_at IS NOT NULL)`,
    client.id,
  );

  const expiresAt = new Date(Date.now() + otpExpiresInMinutes * 60_000);
  await prisma.$executeRawUnsafe(
    `INSERT INTO importadex_client_portal_otps (id, client_id, code_hash, attempts, expires_at, created_at)
     VALUES ($1, $2, $3, 0, $4, CURRENT_TIMESTAMP)`,
    randomUUID(),
    client.id,
    hashOtp(client.id, code),
    expiresAt,
  );
}

async function resolveClientOperationId(clientId: string, operationIdOrCode: string) {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id
     FROM importadex_operations
     WHERE client_id = $1
       AND is_active = true
       AND status NOT IN ('CLOSED', 'CANCELLED')
       AND (id = $2 OR code = $2)
     LIMIT 1`,
    clientId,
    operationIdOrCode,
  );

  return rows[0]?.id ?? null;
}

async function getDocumentName(operationId: string, documentId?: string | null) {
  if (!documentId) return null;

  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM importadex_documents WHERE id = $1 AND operation_id = $2 LIMIT 1`,
    documentId,
    operationId,
  );

  return rows[0]?.name ?? null;
}

function actorFromClient(client: ImportadexPortalClient): ImportadexAuthUser {
  return {
    id: client.id,
    email: client.email,
    name: `Cliente ${clientDisplayName(client)}`,
    role: "IMPORTADEX_CLIENTE",
  };
}

function operationText(operation: unknown, key: string) {
  const record = operation && typeof operation === "object" ? operation as Record<string, unknown> : {};
  const value = record[key];
  return value === null || value === undefined ? null : String(value);
}

function queuePortalEmailTask(label: string, task: () => Promise<unknown>) {
  void task().catch((error) => {
    console.error("Importadex client portal email background task failed", {
      label,
      message: error instanceof Error ? error.message : "Email background task failed",
    });
  });
}

export const importadexClientPortalService = {
  async requestLogin(identification: string) {
    const client = await findClientByIdentification(identification);
    if (!client) {
      throw new ImportadexClientPortalError(404, "No encontramos un cliente con esa identificacion.");
    }

    assertApprovedClient(client);

    const code = generateOtp();
    await storeOtp(client, code);

    queuePortalEmailTask("client-portal-otp", () => sendImportadexClientPortalOtpEmail({
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

  async verifyOtp(identification: string, code: string) {
    const client = await findClientByIdentification(identification);
    if (!client) {
      throw new ImportadexClientPortalError(404, "No encontramos un cliente con esa identificacion.");
    }

    assertApprovedClient(client);

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; code_hash: string; attempts: number; expires_at: Date }>>(
      `SELECT id, code_hash, attempts, expires_at
       FROM importadex_client_portal_otps
       WHERE client_id = $1 AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      client.id,
    );
    const otp = rows[0];

    const expiresAt = otp?.expires_at instanceof Date ? otp.expires_at : new Date(otp?.expires_at ?? 0);
    if (!otp || expiresAt.getTime() < Date.now()) {
      throw new ImportadexClientPortalError(400, "El codigo expiro. Solicita uno nuevo.");
    }

    if (otp.attempts >= maxOtpAttempts) {
      throw new ImportadexClientPortalError(429, "Demasiados intentos. Solicita un codigo nuevo.");
    }

    if (otp.code_hash !== hashOtp(client.id, code)) {
      await prisma.$executeRawUnsafe(
        `UPDATE importadex_client_portal_otps SET attempts = attempts + 1 WHERE id = $1`,
        otp.id,
      );
      throw new ImportadexClientPortalError(400, "Codigo incorrecto.");
    }

    await prisma.$executeRawUnsafe(
      `UPDATE importadex_client_portal_otps SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
      otp.id,
    );

    return {
      token: signClientToken(client.id),
      client: toPublicClient(client),
    };
  },

  async authenticate(token?: string) {
    if (!token) throw new ImportadexClientPortalError(401, "Unauthorized");

    try {
      const decoded = verifyClientToken(token);
      if (decoded.data?.type !== "IMPORTADEX_CLIENT_PORTAL" || !decoded.data.clientId) {
        throw new Error("Invalid client token");
      }

      const client = await findApprovedClientById(decoded.data.clientId);
      if (!client) throw new Error("Client not found");
      return client;
    } catch {
      throw new ImportadexClientPortalError(401, "Unauthorized");
    }
  },

  async listOperations(clientId: string) {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id
       FROM importadex_operations
       WHERE client_id = $1
         AND is_active = true
         AND status NOT IN ('CLOSED', 'CANCELLED')
       ORDER BY created_at DESC`,
      clientId,
    );

    const operations = await Promise.all(rows.map((row) => importadexService.getOperation(row.id)));
    return operations.filter(Boolean);
  },

  async getOperation(clientId: string, operationIdOrCode: string) {
    const operationId = await resolveClientOperationId(clientId, operationIdOrCode);
    if (!operationId) return null;
    return importadexService.getOperation(operationId);
  },

  async uploadAttachments(
    client: ImportadexPortalClient,
    operationIdOrCode: string,
    files: UploadedFile[],
    documentId?: string | null,
  ) {
    if (!files.length) {
      throw new ImportadexClientPortalError(400, "At least one file is required");
    }

    const operationId = await resolveClientOperationId(client.id, operationIdOrCode);
    if (!operationId) return null;

    const documentName = await getDocumentName(operationId, documentId);
    if (documentId && !documentName) return null;

    const operation = await importadexService.createAttachments(
      operationId,
      files,
      documentId,
      actorFromClient(client),
    );

    if (!operation) return null;

    queuePortalEmailTask("client-document-upload", () => sendImportadexClientDocumentUploadEmail({
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
