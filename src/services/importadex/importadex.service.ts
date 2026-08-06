import { randomUUID } from "crypto";
import { prisma } from "../../config/connectionDB";
import {
  checkImportadexEmailHealth,
  sendImportadexClientOperationEmail,
  sendImportadexInternalNotification,
  sendImportadexTestEmail,
} from "../../helpers/emailManaged";
import type { ImportadexAuthUser } from "../../middlewares/importadexAdmin";
import type { UploadedFile } from "../../middlewares/processFiles";

type DbClient = Pick<typeof prisma, "$queryRawUnsafe" | "$executeRawUnsafe">;

export type TableKey =
  | "containers"
  | "customs-files"
  | "incidents"
  | "documents"
  | "attachments";

export type CatalogOptionGroup =
  | "origin"
  | "destination"
  | "port_airport"
  | "carrier"
  | "customs_status"
  | "document_type"
  | "client_source";

export class ImportadexServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const tableMap: Record<TableKey, string> = {
  containers: "importadex_containers",
  "customs-files": "importadex_customs_files",
  incidents: "importadex_incidents",
  documents: "importadex_documents",
  attachments: "importadex_attachments",
};

const tablesWithUpdatedAt = new Set<TableKey>([
  "containers",
  "customs-files",
  "incidents",
  "documents",
]);

const columnMap: Record<string, string> = {
  operationId: "operation_id",
  clientId: "client_id",
  clientName: "client_name",
  operationType: "operation_type",
  transportMode: "transport_mode",
  cargoType: "cargo_type",
  customsStatus: "customs_status",
  createdById: "created_by_id",
  createdByEmail: "created_by_email",
  createdByName: "created_by_name",
  isActive: "is_active",
  deletedAt: "deleted_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
  freeDays: "free_days",
  returnLimit: "return_limit",
  declarationNo: "declaration_no",
  submittedAt: "submitted_at",
  releasedAt: "released_at",
  dueAt: "due_at",
  resolvedAt: "resolved_at",
  eventDate: "event_date",
  fileName: "file_name",
  fileUrl: "file_url",
  fileType: "file_type",
  documentId: "document_id",
};

const operationColumns = [
  "id",
  "code",
  "client_id",
  "client_name",
  "operation_type",
  "transport_mode",
  "cargo_type",
  "status",
  "customs_status",
  "priority",
  "origin",
  "destination",
  "port",
  "carrier",
  "reference",
  "eta",
  "progress",
  "created_by_id",
  "created_by_email",
  "created_by_name",
  "is_active",
  "created_at",
  "updated_at",
];

const catalogOptionGroups = new Set<CatalogOptionGroup>([
  "origin",
  "destination",
  "port_airport",
  "carrier",
  "customs_status",
  "document_type",
  "client_source",
]);

function normalizeCatalogValue(label: string) {
  return label
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function assertCatalogOptionGroup(group: string): asserts group is CatalogOptionGroup {
  if (!catalogOptionGroups.has(group as CatalogOptionGroup)) {
    throw new ImportadexServiceError(400, "Grupo de catalogo no soportado");
  }
}

function toColumn(key: string) {
  return columnMap[key] ?? key;
}

function toDate(value: unknown) {
  return typeof value === "string" && value ? new Date(value) : value;
}

function normalizePayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        toColumn(key),
        key.endsWith("At") || key === "eta" || key === "returnLimit"
          ? toDate(value)
          : value,
      ]),
  );
}

async function audit(
  action: string,
  entity: string,
  entityId: string | null,
  operationId: string | null,
  changes?: unknown,
  db: DbClient = prisma,
  actor?: string | null,
) {
  await db.$executeRawUnsafe(
    `INSERT INTO importadex_audit_logs (id, action, entity, entity_id, operation_id, actor, changes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    randomUUID(),
    action,
    entity,
    entityId,
    operationId,
    actor ?? null,
    JSON.stringify(changes ?? {}),
  );
}

function actorName(actor?: ImportadexAuthUser | null) {
  return actor?.name ?? actor?.email ?? null;
}

function actorCreateFields(actor?: ImportadexAuthUser | null) {
  return {
    createdById: actor?.id ?? null,
    createdByEmail: actor?.email ?? null,
    createdByName: actorName(actor),
  };
}

function rowText(row: unknown, key: string) {
  const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
  const value = record[key];
  return value === null || value === undefined ? null : String(value);
}

async function getOperationSummary(operationId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, code, client_id, client_name, status, customs_status, created_by_name
     FROM importadex_operations
     WHERE id = $1
     LIMIT 1`,
    operationId,
  );

  return rows[0] ?? null;
}

async function notifyOperationEvent(
  subject: string,
  title: string,
  summary: string,
  operationId: string | null | undefined,
  rows: Array<{ label: string; value: string | number | null | undefined }> = [],
) {
  if (!operationId) return;

  const operation = await getOperationSummary(operationId);
  await sendImportadexInternalNotification({
    operationId,
    clientId: rowText(operation, "client_id"),
    subject,
    title,
    summary,
    rows: [
      { label: "Operacion", value: rowText(operation, "code") ?? operationId },
      { label: "Cliente", value: rowText(operation, "client_name") },
      { label: "Estado", value: rowText(operation, "status") },
      { label: "Aduanas", value: rowText(operation, "customs_status") },
      ...rows,
    ],
  });
}

function queueEmailTask(label: string, task: () => Promise<unknown>) {
  void task().catch((error) => {
    console.error("Importadex email background task failed", {
      label,
      message: error instanceof Error ? error.message : "Email background task failed",
    });
  });
}

async function upsertCatalogOption(
  group: CatalogOptionGroup,
  label: unknown,
  db: DbClient = prisma,
) {
  if (typeof label !== "string") return null;
  const cleanLabel = label.trim();
  if (!cleanLabel) return null;

  const value = normalizeCatalogValue(cleanLabel);
  const rows = await db.$queryRawUnsafe<{ group: string; value: string; label: string }[]>(
    `INSERT INTO importadex_catalogs (id, "group", value, label, active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT ("group", value) DO UPDATE SET label = EXCLUDED.label, active = true
     RETURNING "group", value, label`,
    randomUUID(),
    group,
    value,
    cleanLabel,
  );

  if (group === "carrier") {
    await db.$executeRawUnsafe(
      `INSERT INTO importadex_carriers (id, name, active)
       VALUES ($1, $2, true)
       ON CONFLICT (name) DO UPDATE SET active = true`,
      randomUUID(),
      cleanLabel,
    );
  }

  return rows[0] ?? { group, value, label: cleanLabel };
}

function formatClientDisplayName(row: { name: string; last_name?: string | null }) {
  return `${row.name}${row.last_name ? ` ${row.last_name}` : ""}`;
}

async function resolveApprovedClient(clientName: unknown) {
  const cleanClientName = typeof clientName === "string" ? clientName.trim() : "";
  if (!cleanClientName) {
    throw new ImportadexServiceError(400, "Selecciona un cliente aprobado");
  }

  const rows = await prisma.$queryRawUnsafe<{ id: string; name: string; last_name: string | null; email: string }[]>(
    `SELECT id, name, last_name, email
     FROM importadex_clients
     WHERE active = true
       AND review_status = 'APPROVED'
       AND (
         name = $1 OR
         CONCAT(name, CASE WHEN last_name IS NULL OR BTRIM(last_name) = '' THEN '' ELSE CONCAT(' ', last_name) END) = $1
       )
     LIMIT 1`,
    cleanClientName,
  );

  if (!rows[0]) {
    throw new ImportadexServiceError(400, "La operacion requiere un cliente aprobado");
  }

  return {
    id: rows[0].id,
    displayName: formatClientDisplayName(rows[0]),
    email: rows[0].email,
  };
}

async function insert(table: string, payload: Record<string, unknown>, db: DbClient = prisma) {
  const id = randomUUID();
  const data = normalizePayload({ id, ...payload });
  const columns = Object.keys(data);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const values = Object.values(data);
  const rows = await db.$queryRawUnsafe<unknown[]>(
    `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")})
     VALUES (${placeholders}) RETURNING *`,
    ...values,
  );
  return rows[0];
}

async function patch(
  table: string,
  id: string,
  payload: Record<string, unknown>,
  db: DbClient = prisma,
) {
  const data = normalizePayload(payload);
  const columns = Object.keys(data);
  if (columns.length === 0) return findById(table, id, db);
  const assignments = columns
    .map((column, index) => `"${column}" = $${index + 2}`)
    .join(", ");
  const rows = await db.$queryRawUnsafe<unknown[]>(
    `UPDATE ${table} SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
    id,
    ...Object.values(data),
  );
  return rows[0] ?? null;
}

async function findById(table: string, id: string, db: DbClient = prisma) {
  const rows = await db.$queryRawUnsafe<unknown[]>(
    `SELECT * FROM ${table} WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

function getTransportDocumentName(transportMode: unknown) {
  if (transportMode === "AIR") return "Guia aerea AWB";
  if (transportMode === "LAND") return "Carta porte terrestre";
  return "Conocimiento de embarque BL";
}

function buildDefaultDocuments(operationPayload: Record<string, unknown>) {
  return [
    { name: "Factura comercial", type: "COMMERCIAL_INVOICE", status: "PENDING", owner: "Cliente", url: null },
    { name: "Packing list", type: "PACKING_LIST", status: "PENDING", owner: "Cliente", url: null },
    { name: getTransportDocumentName(operationPayload.transportMode), type: "TRANSPORT_DOCUMENT", status: "PENDING", owner: "Carrier", url: null },
    { name: "Declaracion aduanal", type: "CUSTOMS_DECLARATION", status: "PENDING", owner: "Aduanas", url: null },
    { name: "Permisos y certificados", type: "PERMITS", status: "PENDING", owner: "Cliente", url: null },
    { name: "Comprobante de pago", type: "PAYMENT_PROOF", status: "PENDING", owner: "Cliente", url: null },
  ];
}

function documentProgressValue(status: unknown) {
  const normalizedStatus = String(status ?? "PENDING").trim().toUpperCase();

  if (["APPROVED", "RECEIVED", "VALIDATED", "APROBADO", "RECIBIDO", "VALIDADO"].includes(normalizedStatus)) return 100;
  if (["IN_REVIEW", "REVIEW", "EN_REVISION", "EN REVISION", "REVISION"].includes(normalizedStatus)) return 50;
  return 0;
}

async function recalculateDocumentProgress(operationId: string, db: DbClient = prisma) {
  const documents = await db.$queryRawUnsafe<{ status: string }[]>(
    `SELECT status FROM importadex_documents WHERE operation_id = $1`,
    operationId,
  );
  const progress = documents.length
    ? Math.round(documents.reduce((total, document) => total + documentProgressValue(document.status), 0) / documents.length)
    : 0;

  await db.$executeRawUnsafe(
    `UPDATE importadex_operations SET progress = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    operationId,
    progress,
  );

  return progress;
}

function asRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getInitialContainers(container: unknown, containers: unknown, operationPayload: Record<string, unknown>, code: unknown) {
  const containerRows = asRecordArray(containers);
  const legacyContainer = asRecord(container);

  if (containerRows.length) return containerRows;
  if (legacyContainer) return [legacyContainer];
  if (operationPayload.cargoType !== "CONTAINERIZED") return [];

  return [
    {
      number: `PEND-${String(code).replace(/[^a-zA-Z0-9-]/g, "").slice(-12)}`,
      type: "Pendiente de asignacion",
      seal: null,
      carrier: operationPayload.carrier ?? null,
      freeDays: 0,
      returnLimit: null,
      status: "PENDING_ASSIGNMENT",
    },
  ];
}

export const importadexService = {
  async listOperations(filters: {
    q?: string;
    status?: string;
    mode?: string;
  }) {
    const clauses = [`is_active = true`];
    const values: unknown[] = [];
    if (filters.status) {
      values.push(filters.status);
      clauses.push(`status = $${values.length}`);
    }
    if (filters.mode) {
      values.push(filters.mode);
      clauses.push(`transport_mode = $${values.length}`);
    }
    if (filters.q) {
      values.push(`%${filters.q}%`);
      clauses.push(
        `(code ILIKE $${values.length} OR client_name ILIKE $${values.length} OR reference ILIKE $${values.length})`,
      );
    }

    return prisma.$queryRawUnsafe<unknown[]>(
      `SELECT ${operationColumns.map((column) => `"${column}"`).join(", ")}
       FROM importadex_operations
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC`,
      ...values,
    );
  },

  async getOperation(id: string) {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT o.*,
        COALESCE((SELECT json_agg(c.*) FROM importadex_containers c WHERE c.operation_id = o.id), '[]') AS containers,
        COALESCE((SELECT json_agg(ci.*) FROM importadex_cargo_items ci WHERE ci.operation_id = o.id), '[]') AS cargo_items,
        COALESCE((SELECT json_agg(d.*) FROM importadex_documents d WHERE d.operation_id = o.id), '[]') AS documents,
        COALESCE((SELECT json_agg(cf.*) FROM importadex_customs_files cf WHERE cf.operation_id = o.id), '[]') AS customs_files,
        COALESCE((SELECT json_agg(i.*) FROM importadex_incidents i WHERE i.operation_id = o.id), '[]') AS incidents,
        COALESCE((SELECT json_agg(e.* ORDER BY e.event_date) FROM importadex_events e WHERE e.operation_id = o.id), '[]') AS events,
        COALESCE((SELECT json_agg(cm.* ORDER BY cm.created_at) FROM importadex_comments cm WHERE cm.operation_id = o.id), '[]') AS comments,
        COALESCE((SELECT json_agg(a.* ORDER BY a.created_at DESC) FROM importadex_attachments a WHERE a.operation_id = o.id), '[]') AS attachments
       FROM importadex_operations o
       WHERE o.id = $1 AND o.is_active = true`,
      id,
    );
    return rows[0] ?? null;
  },

  async createOperation(payload: Record<string, unknown>, actor?: ImportadexAuthUser | null) {
    const { container, containers, documents, customsFile, incidents, ...operationPayload } = payload;
    const client = await resolveApprovedClient(operationPayload.clientName);
    operationPayload.clientId = client.id;
    operationPayload.clientName = client.displayName;
    const code =
      operationPayload.code ??
      `IMPX-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

    const operationId = await prisma.$transaction(async (tx) => {
      await upsertCatalogOption("origin", operationPayload.origin, tx);
      await upsertCatalogOption("destination", operationPayload.destination, tx);
      await upsertCatalogOption("port_airport", operationPayload.port, tx);
      await upsertCatalogOption("carrier", operationPayload.carrier, tx);
      await upsertCatalogOption("customs_status", operationPayload.customsStatus, tx);

      const operation = await insert("importadex_operations", {
        ...operationPayload,
        code,
        ...actorCreateFields(actor),
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, tx);
      const createdOperationId = (operation as { id: string }).id;

      const initialContainers = getInitialContainers(container, containers, operationPayload, code);
      for (const initialContainer of initialContainers) {
        const containerNumber =
          typeof initialContainer.number === "string" && initialContainer.number.trim()
            ? initialContainer.number.trim()
            : `PEND-${String(code).replace(/[^a-zA-Z0-9-]/g, "").slice(-12)}`;

        await insert("importadex_containers", {
          operationId: createdOperationId,
          number: containerNumber,
          type: initialContainer.type ?? "Pendiente de asignacion",
          seal: initialContainer.seal ?? null,
          carrier: initialContainer.carrier ?? operationPayload.carrier ?? null,
          freeDays: initialContainer.freeDays ?? 0,
          returnLimit: initialContainer.returnLimit ?? null,
          status: initialContainer.status ?? "TYPE_SELECTED",
          createdAt: new Date(),
          updatedAt: new Date(),
        }, tx);
      }

      const initialDocuments = asRecordArray(documents);
      const documentRows = initialDocuments.length ? initialDocuments : buildDefaultDocuments(operationPayload);
      for (const document of documentRows) {
        await upsertCatalogOption("document_type", document.name, tx);
        await insert("importadex_documents", {
          operationId: createdOperationId,
          name: document.name,
          type: document.type,
          status: document.status ?? "PENDING",
          owner: document.owner ?? null,
          url: document.url ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, tx);
      }

      const initialCustomsFile = asRecord(customsFile) ?? (operationPayload.customsStatus ? { status: operationPayload.customsStatus } : null);
      if (initialCustomsFile) {
        await insert("importadex_customs_files", {
          operationId: createdOperationId,
          declarationNo: initialCustomsFile.declarationNo ?? null,
          regime: initialCustomsFile.regime ?? null,
          channel: initialCustomsFile.channel ?? null,
          status: initialCustomsFile.status ?? operationPayload.customsStatus ?? "PENDING",
          responsible: initialCustomsFile.responsible ?? "Aduanas",
          submittedAt: initialCustomsFile.submittedAt ?? null,
          releasedAt: initialCustomsFile.releasedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, tx);
      }

      for (const incident of asRecordArray(incidents)) {
        await insert("importadex_incidents", {
          operationId: createdOperationId,
          type: incident.type,
          severity: incident.severity ?? "MEDIUM",
          status: incident.status ?? "OPEN",
          owner: incident.owner ?? null,
          description: incident.description ?? null,
          dueAt: incident.dueAt ?? null,
          resolvedAt: incident.resolvedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, tx);
      }

      await recalculateDocumentProgress(createdOperationId, tx);
      await audit("CREATE", "operation", createdOperationId, createdOperationId, {
        operation,
        documents: documentRows.length,
        containers: initialContainers.length,
        incidents: asRecordArray(incidents).length,
      }, tx, actorName(actor));
      await insert("importadex_events", {
        operation_id: createdOperationId,
        event: "Operacion creada con checklist documental inicial",
        owner: "system",
        location: operationPayload.origin,
        created_at: new Date(),
      }, tx);

      return createdOperationId;
    });

    const operation = await this.getOperation(operationId);
    queueEmailTask("operation-created-internal", () => notifyOperationEvent(
      "Operacion Importadex creada",
      "Operacion Importadex creada",
      "Se creo una nueva operacion en el modulo Importadex.",
      operationId,
      [
        { label: "Creada por", value: actorName(actor) },
        { label: "Origen", value: rowText(operation, "origin") },
        { label: "Destino", value: rowText(operation, "destination") },
      ],
    ));
    queueEmailTask("operation-created-client", () => sendImportadexClientOperationEmail({
      operationId,
      clientId: client.id,
      clientName: client.displayName,
      clientEmail: client.email,
      operationCode: rowText(operation, "code") ?? String(code),
      operationType: rowText(operation, "operation_type"),
      transportMode: rowText(operation, "transport_mode"),
      status: rowText(operation, "status"),
      origin: rowText(operation, "origin"),
      destination: rowText(operation, "destination"),
    }));
    return operation;
  },

  async updateOperation(id: string, payload: Record<string, unknown>, actor?: ImportadexAuthUser | null) {
    const nextPayload = { ...payload };
    if (typeof nextPayload.clientName === "string") {
      const client = await resolveApprovedClient(nextPayload.clientName);
      nextPayload.clientId = client.id;
      nextPayload.clientName = client.displayName;
    }

    const operation = await patch("importadex_operations", id, nextPayload);
    await audit("UPDATE", "operation", id, id, nextPayload, prisma, actorName(actor));
    return operation;
  },

  async updateStatus(id: string, status: string, note?: string, actor?: ImportadexAuthUser | null) {
    await patch("importadex_operations", id, { status });
    await insert("importadex_events", {
      operationId: id,
      event: `Cambio de estado a ${status}`,
      owner: "system",
      location: note ?? null,
    });
    await audit("STATUS_CHANGE", "operation", id, id, { status, note }, prisma, actorName(actor));
    const operation = await this.getOperation(id);
    queueEmailTask("operation-status-internal", () => notifyOperationEvent(
      status === "DELIVERED" ? "Transporte Importadex entregado" : "Avance operativo Importadex",
      status === "DELIVERED" ? "Transporte marcado como entregado" : "Avance operativo registrado",
      status === "DELIVERED"
        ? "Una operacion/transporte fue marcado como entregado en Importadex."
        : "Una operacion Importadex cambio de estado operativo.",
      id,
      [
        { label: "Nuevo estado", value: status },
        { label: "Nota", value: note },
        { label: "Usuario", value: actorName(actor) },
      ],
    ));
    return operation;
  },

  async listTable(key: TableKey) {
    return prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM ${tableMap[key]} ORDER BY created_at DESC`,
    );
  },

  async createTable(key: TableKey, payload: Record<string, unknown>, actor?: ImportadexAuthUser | null) {
    const operationId = typeof payload.operationId === "string" ? payload.operationId : undefined;

    if (operationId && !(await findById("importadex_operations", operationId))) {
      throw new ImportadexServiceError(404, "Operation not found");
    }

    const item = await insert(
      tableMap[key],
      tablesWithUpdatedAt.has(key)
        ? { ...payload, createdAt: new Date(), updatedAt: new Date() }
        : payload,
    );
    const itemOperationId = (item as { operation_id?: string }).operation_id ?? operationId;

    if (key === "documents" && itemOperationId) {
      await upsertCatalogOption("document_type", (item as { name?: string }).name);
      await recalculateDocumentProgress(itemOperationId);
      await insert("importadex_events", {
        operationId: itemOperationId,
        event: `Documento creado: ${(item as { name?: string }).name ?? "Documento"}`,
        owner: "system",
        location: (item as { status?: string }).status ?? "PENDING",
      });
      queueEmailTask("document-created-internal", () => notifyOperationEvent(
        "Avance documental Importadex",
        "Documento creado en operacion Importadex",
        "Se creo un documento en el expediente documental de una operacion.",
        itemOperationId,
        [
          { label: "Documento", value: (item as { name?: string }).name },
          { label: "Estado", value: (item as { status?: string }).status },
          { label: "Usuario", value: actorName(actor) },
        ],
      ));
    }

    if (key === "customs-files" && itemOperationId) {
      const status = (item as { status?: string }).status;
      if (status) {
        await upsertCatalogOption("customs_status", status);
        await patch("importadex_operations", itemOperationId, { customsStatus: status });
      }
      await insert("importadex_events", {
        operationId: itemOperationId,
        event: `Expediente aduanal creado: ${status ?? "Sin estado"}`,
        owner: (item as { responsible?: string }).responsible ?? "Aduanas",
        location: (item as { declaration_no?: string }).declaration_no ?? null,
      });
      queueEmailTask("customs-created-internal", () => notifyOperationEvent(
        "Estado aduanal Importadex modificado",
        "Expediente aduanal creado",
        "Se creo o actualizo el estado aduanal de una operacion Importadex.",
        itemOperationId,
        [
          { label: "Estado aduanal", value: status },
          { label: "Responsable", value: (item as { responsible?: string }).responsible },
          { label: "Usuario", value: actorName(actor) },
        ],
      ));
    }

    if (key === "incidents" && itemOperationId) {
      await insert("importadex_events", {
        operationId: itemOperationId,
        event: `Incidencia registrada: ${(item as { type?: string }).type ?? "Incidencia"}`,
        owner: (item as { owner?: string }).owner ?? "system",
        location: (item as { status?: string }).status ?? "OPEN",
      });
    }

    await audit(
      "CREATE",
      key,
      (item as { id: string }).id,
      itemOperationId ?? null,
      item,
      prisma,
      actorName(actor),
    );
    return item;
  },

  async listAttachments(operationId: string) {
    return prisma.$queryRawUnsafe<unknown[]>(
      `SELECT *
       FROM importadex_attachments
       WHERE operation_id = $1
       ORDER BY created_at DESC`,
      operationId,
    );
  },

  async createAttachments(operationId: string, files: UploadedFile[], documentId?: string | null, actor?: ImportadexAuthUser | null) {
    const operation = await findById("importadex_operations", operationId);
    if (!operation) return null;

    const documentRows = documentId
      ? await prisma.$queryRawUnsafe<{ id: string; name: string; status: string }[]>(
          `SELECT id, name, status FROM importadex_documents WHERE id = $1 AND operation_id = $2`,
          documentId,
          operationId,
        )
      : [];
    const document = documentRows[0] ?? null;

    if (documentId && !document) return null;

    const attachments = await Promise.all(
      files.map((file) =>
        insert("importadex_attachments", {
          operationId,
          documentId: document?.id ?? null,
          fileName: file.originalName || file.fileName,
          fileUrl: file.url,
          fileType: file.mimeType,
        }),
      ),
    );

    if (document) {
      await prisma.$executeRawUnsafe(
        `UPDATE importadex_documents
         SET status = CASE WHEN status = 'APPROVED' THEN status ELSE 'RECEIVED' END,
             url = COALESCE($2, url),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        document.id,
        files[0]?.url ?? null,
      );
      await recalculateDocumentProgress(operationId);
    }

    await insert("importadex_events", {
      operationId,
      event: document ? `Documento recibido: ${document.name}` : "Evidencia cargada",
      owner: "system",
      location: files
        .map((file) => file.originalName || file.fileName)
        .join(", "),
    });
    await audit("CREATE", "attachments", null, operationId, { documentId: document?.id ?? null, attachments }, prisma, actorName(actor));
    queueEmailTask("attachments-created-internal", () => notifyOperationEvent(
      document ? "Avance documental Importadex" : "Evidencia Importadex creada",
      document ? "Documento recibido con evidencia" : "Evidencia cargada en operacion",
      document
        ? "Se cargo una evidencia asociada a un documento de la operacion."
        : "Se cargo una nueva evidencia en la operacion Importadex.",
      operationId,
      [
        { label: "Documento", value: document?.name },
        { label: "Archivos", value: files.map((file) => file.originalName || file.fileName).join(", ") },
        { label: "Usuario", value: actorName(actor) },
      ],
    ));

    return this.getOperation(operationId);
  },

  async updateTable(
    key: TableKey,
    id: string,
    payload: Record<string, unknown>,
    actor?: ImportadexAuthUser | null,
  ) {
    const item = await patch(tableMap[key], id, payload);
    const operationId = (item as { operation_id?: string } | null)?.operation_id ?? null;

    if (key === "documents" && operationId) {
      await recalculateDocumentProgress(operationId);
      await insert("importadex_events", {
        operationId,
        event: `Documento actualizado: ${(item as { name?: string }).name ?? "Documento"}`,
        owner: "system",
        location: (item as { status?: string }).status ?? null,
      });
      queueEmailTask("document-updated-internal", () => notifyOperationEvent(
        "Avance documental Importadex",
        "Documento actualizado en operacion Importadex",
        "Se actualizo un documento del expediente documental de una operacion.",
        operationId,
        [
          { label: "Documento", value: (item as { name?: string }).name },
          { label: "Estado", value: (item as { status?: string }).status },
          { label: "Usuario", value: actorName(actor) },
        ],
      ));
    }

    if (key === "customs-files" && operationId) {
      const status = (item as { status?: string }).status;
      if (status) {
        await upsertCatalogOption("customs_status", status);
        await patch("importadex_operations", operationId, { customsStatus: status });
      }
      await insert("importadex_events", {
        operationId,
        event: `Expediente aduanal actualizado: ${status ?? "Sin estado"}`,
        owner: (item as { responsible?: string }).responsible ?? "Aduanas",
        location: (item as { declaration_no?: string }).declaration_no ?? null,
      });
      queueEmailTask("customs-updated-internal", () => notifyOperationEvent(
        "Estado aduanal Importadex modificado",
        "Expediente aduanal actualizado",
        "Se modifico el estado aduanal de una operacion Importadex.",
        operationId,
        [
          { label: "Estado aduanal", value: status },
          { label: "Responsable", value: (item as { responsible?: string }).responsible },
          { label: "Usuario", value: actorName(actor) },
        ],
      ));
    }

    if (key === "incidents" && operationId) {
      await insert("importadex_events", {
        operationId,
        event: `Incidencia actualizada: ${(item as { type?: string }).type ?? "Incidencia"}`,
        owner: (item as { owner?: string }).owner ?? "system",
        location: (item as { status?: string }).status ?? null,
      });
    }

    await audit(
      "UPDATE",
      key,
      id,
      operationId,
      payload,
      prisma,
      actorName(actor),
    );
    return item;
  },

  async listEvents(operationId: string) {
    return prisma.$queryRawUnsafe<unknown[]>(
      "SELECT * FROM importadex_events WHERE operation_id = $1 ORDER BY event_date ASC",
      operationId,
    );
  },

  async createEvent(operationId: string, payload: Record<string, unknown>, actor?: ImportadexAuthUser | null) {
    const event = await insert("importadex_events", {
      ...payload,
      operationId,
    });
    await audit(
      "CREATE",
      "event",
      (event as { id: string }).id,
      operationId,
      event,
      prisma,
      actorName(actor),
    );
    queueEmailTask("event-created-internal", () => notifyOperationEvent(
      "Avance operativo Importadex",
      "Evento operativo registrado",
      "Se registro un avance operativo en la linea de tiempo de una operacion Importadex.",
      operationId,
      [
        { label: "Evento", value: (event as { event?: string }).event },
        { label: "Usuario", value: actorName(actor) },
      ],
    ));
    return event;
  },

  async listComments(operationId: string) {
    return prisma.$queryRawUnsafe<unknown[]>(
      "SELECT * FROM importadex_comments WHERE operation_id = $1 ORDER BY created_at ASC",
      operationId,
    );
  },

  async createComment(operationId: string, payload: Record<string, unknown>) {
    const comment = await insert("importadex_comments", {
      ...payload,
      operationId,
    });
    await audit(
      "CREATE",
      "comment",
      (comment as { id: string }).id,
      operationId,
      comment,
    );
    return comment;
  },

  async catalogs() {
    return prisma.$queryRawUnsafe<unknown[]>(
      `WITH option_rows AS (
        SELECT "group", value, label FROM importadex_catalogs WHERE active = true
        UNION SELECT 'origin' AS "group", origin AS value, origin AS label FROM importadex_operations WHERE origin IS NOT NULL AND BTRIM(origin) <> ''
        UNION SELECT 'destination' AS "group", destination AS value, destination AS label FROM importadex_operations WHERE destination IS NOT NULL AND BTRIM(destination) <> ''
        UNION SELECT 'port_airport' AS "group", port AS value, port AS label FROM importadex_operations WHERE port IS NOT NULL AND BTRIM(port) <> ''
        UNION SELECT 'port_airport' AS "group", name AS value, name AS label FROM importadex_ports WHERE active = true AND BTRIM(name) <> ''
        UNION SELECT 'port_airport' AS "group", code AS value, CONCAT(code, ' - ', name) AS label FROM importadex_airports WHERE active = true AND BTRIM(code) <> ''
        UNION SELECT 'carrier' AS "group", carrier AS value, carrier AS label FROM importadex_operations WHERE carrier IS NOT NULL AND BTRIM(carrier) <> ''
        UNION SELECT 'carrier' AS "group", carrier AS value, carrier AS label FROM importadex_containers WHERE carrier IS NOT NULL AND BTRIM(carrier) <> ''
        UNION SELECT 'carrier' AS "group", name AS value, name AS label FROM importadex_carriers WHERE active = true AND BTRIM(name) <> ''
        UNION SELECT 'customs_status' AS "group", customs_status AS value, customs_status AS label FROM importadex_operations WHERE customs_status IS NOT NULL AND BTRIM(customs_status) <> ''
        UNION SELECT 'customs_status' AS "group", status AS value, status AS label FROM importadex_customs_files WHERE status IS NOT NULL AND BTRIM(status) <> ''
        UNION SELECT 'document_type' AS "group", name AS value, name AS label FROM importadex_documents WHERE name IS NOT NULL AND BTRIM(name) <> ''
        UNION SELECT 'client_source' AS "group", discovery_source AS value, discovery_source AS label FROM importadex_clients WHERE discovery_source IS NOT NULL AND BTRIM(discovery_source) <> ''
      )
      SELECT DISTINCT ON ("group", LOWER(label)) "group", value, label
      FROM option_rows
      ORDER BY "group", LOWER(label), label`,
    );
  },

  async createCatalogOption(payload: { group: string; label: string }) {
    assertCatalogOptionGroup(payload.group);
    return upsertCatalogOption(payload.group, payload.label);
  },

  async dashboard() {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('CLOSED', 'CANCELLED'))::int AS open_operations,
        COUNT(*) FILTER (WHERE operation_type = 'IMPORT' AND status NOT IN ('CLOSED', 'CANCELLED'))::int AS active_imports,
        COUNT(*) FILTER (WHERE operation_type = 'EXPORT' AND status NOT IN ('CLOSED', 'CANCELLED'))::int AS active_exports,
        (SELECT COUNT(*)::int FROM importadex_containers WHERE status ILIKE '%TRANSIT%' OR status ILIKE '%TRANSITO%') AS containers_in_transit,
        COUNT(*) FILTER (WHERE cargo_type IN ('LOOSE', 'LCL', 'BREAKBULK'))::int AS loose_cargo,
        COUNT(*) FILTER (WHERE status = 'IN_CUSTOMS' OR customs_status ILIKE '%pend%')::int AS customs_pending,
        (SELECT COUNT(DISTINCT operation_id)::int FROM importadex_documents WHERE status <> 'RECEIVED') AS pending_documents,
        (SELECT COUNT(DISTINCT operation_id)::int FROM importadex_incidents WHERE status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')) AS operations_with_incidents,
        (SELECT COUNT(*)::int FROM importadex_containers WHERE status ILIKE '%RETURN%' OR status ILIKE '%DEVOL%') AS containers_pending_return,
        COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_operations
       FROM importadex_operations
       WHERE is_active = true`,
    );
    return rows[0];
  },

  async reports() {
    const summaryRows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT
        COUNT(*)::int AS total_operations,
        COUNT(*) FILTER (WHERE status NOT IN ('CLOSED', 'CANCELLED'))::int AS open_operations,
        COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_operations,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_operations,
        COALESCE(ROUND(AVG(progress))::int, 0)::int AS average_document_progress,
        COUNT(*) FILTER (WHERE eta IS NOT NULL AND eta < CURRENT_TIMESTAMP AND status NOT IN ('CLOSED', 'CANCELLED'))::int AS eta_expired,
        COALESCE(ROUND((AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at)) / 86400) FILTER (WHERE status NOT IN ('CLOSED', 'CANCELLED')))::numeric, 1), 0) AS average_open_age_days
       FROM importadex_operations
       WHERE is_active = true`,
    );

    const documentRows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE UPPER(status) = 'PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE UPPER(status) IN ('IN_REVIEW', 'REVIEW', 'EN_REVISION', 'EN REVISION'))::int AS in_review,
        COUNT(*) FILTER (WHERE UPPER(status) = 'RECEIVED')::int AS received,
        COUNT(*) FILTER (WHERE UPPER(status) IN ('APPROVED', 'VALIDATED'))::int AS approved,
        COALESCE(ROUND((COUNT(*) FILTER (WHERE UPPER(status) IN ('RECEIVED', 'APPROVED', 'VALIDATED'))::numeric / NULLIF(COUNT(*), 0)) * 100)::int, 0)::int AS compliance_rate,
        (SELECT COUNT(DISTINCT operation_id)::int FROM importadex_documents WHERE UPPER(status) NOT IN ('RECEIVED', 'APPROVED', 'VALIDATED')) AS operations_with_pending
       FROM importadex_documents`,
    );

    const incidentRows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked,
        COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical,
        COUNT(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED'))::int AS active
       FROM importadex_incidents`,
    );

    const customsRows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE UPPER(status) LIKE '%PEND%')::int AS pending,
        COUNT(*) FILTER (WHERE UPPER(status) LIKE '%REVIEW%' OR UPPER(status) LIKE '%REVISION%')::int AS in_review,
        COUNT(*) FILTER (WHERE released_at IS NOT NULL OR UPPER(status) LIKE '%RELEASE%' OR UPPER(status) LIKE '%LIBER%' OR UPPER(status) LIKE '%LEVANTE%' OR UPPER(status) = 'APPROVED')::int AS released,
        COALESCE(ROUND((AVG(EXTRACT(EPOCH FROM (released_at - submitted_at)) / 86400) FILTER (WHERE submitted_at IS NOT NULL AND released_at IS NOT NULL))::numeric, 1), 0) AS average_release_days
       FROM importadex_customs_files`,
    );

    const containerRows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE UPPER(status) LIKE '%RETURN%' OR UPPER(status) LIKE '%DEVOL%')::int AS pending_return,
        COUNT(*) FILTER (WHERE return_limit IS NOT NULL AND return_limit < CURRENT_TIMESTAMP AND UPPER(status) NOT LIKE '%RETURNED%' AND UPPER(status) NOT LIKE '%DEVUELTO%')::int AS expired_returns,
        COUNT(*) FILTER (WHERE return_limit IS NOT NULL AND return_limit >= CURRENT_TIMESTAMP AND return_limit <= CURRENT_TIMESTAMP + INTERVAL '3 days')::int AS due_soon,
        COUNT(*) FILTER (WHERE return_limit IS NULL)::int AS without_return_limit
       FROM importadex_containers`,
    );

    const byType = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT operation_type AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY operation_type
       ORDER BY operation_type`,
    );
    const byMode = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT transport_mode AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY transport_mode
       ORDER BY transport_mode`,
    );
    const byStatus = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT status AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY status
       ORDER BY total DESC, status`,
    );
    const documentsByStatus = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT status AS label, COUNT(*)::int AS total
       FROM importadex_documents
       GROUP BY status
       ORDER BY total DESC, status`,
    );
    const incidentsBySeverity = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT severity AS label, COUNT(*)::int AS total
       FROM importadex_incidents
       GROUP BY severity
       ORDER BY total DESC, severity`,
    );
    const incidentsByStatus = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT status AS label, COUNT(*)::int AS total
       FROM importadex_incidents
       GROUP BY status
       ORDER BY total DESC, status`,
    );
    const customsByStatus = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT status AS label, COUNT(*)::int AS total
       FROM importadex_customs_files
       GROUP BY status
       ORDER BY total DESC, status`,
    );
    const topClients = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT client_name AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY client_name
       ORDER BY total DESC, client_name
       LIMIT 8`,
    );
    const monthlyOperations = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY date_trunc('month', created_at)
       ORDER BY label DESC
       LIMIT 12`,
    );
    const operationsByCreator = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT COALESCE(NULLIF(created_by_name, ''), NULLIF(created_by_email, ''), 'Sin creador registrado') AS label,
        COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY COALESCE(NULLIF(created_by_name, ''), NULLIF(created_by_email, ''), 'Sin creador registrado')
       ORDER BY total DESC, label
       LIMIT 12`,
    );
    const clientsByDiscoverySource = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT COALESCE(NULLIF(discovery_source, ''), 'Sin origen registrado') AS label,
        COUNT(*)::int AS total
       FROM importadex_clients
       GROUP BY COALESCE(NULLIF(discovery_source, ''), 'Sin origen registrado')
       ORDER BY total DESC, label
       LIMIT 12`,
    );
    const operationsByDiscoverySource = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT COALESCE(NULLIF(c.discovery_source, ''), 'Sin origen registrado') AS label,
        COUNT(*)::int AS total
       FROM importadex_operations o
       LEFT JOIN LATERAL (
         SELECT discovery_source
         FROM importadex_clients c
         WHERE c.id = o.client_id
           OR (
             o.client_id IS NULL
             AND (
               o.client_name = c.name
               OR o.client_name = CONCAT(c.name, CASE WHEN c.last_name IS NULL OR BTRIM(c.last_name) = '' THEN '' ELSE CONCAT(' ', c.last_name) END)
             )
           )
         ORDER BY CASE WHEN c.id = o.client_id THEN 0 ELSE 1 END, c.created_at DESC
         LIMIT 1
       ) c ON true
       WHERE o.is_active = true
       GROUP BY COALESCE(NULLIF(c.discovery_source, ''), 'Sin origen registrado')
       ORDER BY total DESC, label
       LIMIT 12`,
    );
    const recentOperationsByCreator = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT id, code, client_name, status, created_by_name, created_by_email, created_at
       FROM importadex_operations
       WHERE is_active = true
       ORDER BY created_at DESC
       LIMIT 20`,
    );
    const riskOperations = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT
        o.id,
        o.code,
        o.client_name,
        o.status,
        o.progress,
        o.eta,
        COALESCE(pd.total, 0)::int AS pending_documents,
        COALESCE(ai.total, 0)::int AS active_incidents,
        COALESCE(ec.total, 0)::int AS expired_containers
       FROM importadex_operations o
       LEFT JOIN (
         SELECT operation_id, COUNT(*)::int AS total
         FROM importadex_documents
         WHERE UPPER(status) NOT IN ('RECEIVED', 'APPROVED', 'VALIDATED')
         GROUP BY operation_id
       ) pd ON pd.operation_id = o.id
       LEFT JOIN (
         SELECT operation_id, COUNT(*)::int AS total
         FROM importadex_incidents
         WHERE status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
         GROUP BY operation_id
       ) ai ON ai.operation_id = o.id
       LEFT JOIN (
         SELECT operation_id, COUNT(*)::int AS total
         FROM importadex_containers
         WHERE return_limit IS NOT NULL AND return_limit < CURRENT_TIMESTAMP AND UPPER(status) NOT LIKE '%RETURNED%' AND UPPER(status) NOT LIKE '%DEVUELTO%'
         GROUP BY operation_id
       ) ec ON ec.operation_id = o.id
       WHERE o.is_active = true
         AND o.status NOT IN ('CLOSED', 'CANCELLED')
         AND (
           COALESCE(pd.total, 0) > 0 OR
           COALESCE(ai.total, 0) > 0 OR
           COALESCE(ec.total, 0) > 0 OR
           (o.eta IS NOT NULL AND o.eta < CURRENT_TIMESTAMP)
         )
       ORDER BY COALESCE(ai.total, 0) DESC, COALESCE(ec.total, 0) DESC, COALESCE(pd.total, 0) DESC, o.created_at ASC
       LIMIT 10`,
    );

    return {
      summary: summaryRows[0],
      documents: documentRows[0],
      incidents: incidentRows[0],
      customs: customsRows[0],
      containers: containerRows[0],
      byType,
      byMode,
      byStatus,
      documentsByStatus,
      incidentsBySeverity,
      incidentsByStatus,
      customsByStatus,
      topClients,
      monthlyOperations,
      operationsByCreator,
      clientsByDiscoverySource,
      operationsByDiscoverySource,
      recentOperationsByCreator,
      riskOperations,
    };
  },

  async listEmailLogs(limitInput?: unknown) {
    const limit = Math.min(Math.max(Number(limitInput) || 50, 1), 200);
    return prisma.$queryRawUnsafe<unknown[]>(
      `SELECT id, status, audience, subject, recipient_masked, recipient_domain,
        operation_id, client_id, smtp_host, smtp_user, message_id, smtp_response,
        accepted, rejected, skipped, error_code, error_message, created_at, updated_at
       FROM importadex_email_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      limit,
    );
  },

  async sendEmailTest(to: string, actor?: ImportadexAuthUser | null) {
    return sendImportadexTestEmail(to, actorName(actor));
  },

  async emailHealth() {
    return checkImportadexEmailHealth();
  },
};
