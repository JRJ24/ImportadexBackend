import { randomUUID } from "crypto";
import { prisma } from "../../config/connectionDB";
import type { UploadedFile } from "../../middlewares/processFiles";

export type TableKey = "containers" | "customs-files" | "incidents" | "documents" | "attachments";

const tableMap: Record<TableKey, string> = {
  containers: "importadex_containers",
  "customs-files": "importadex_customs_files",
  incidents: "importadex_incidents",
  documents: "importadex_documents",
  attachments: "importadex_attachments",
};

const columnMap: Record<string, string> = {
  operationId: "operation_id",
  clientName: "client_name",
  operationType: "operation_type",
  transportMode: "transport_mode",
  cargoType: "cargo_type",
  customsStatus: "customs_status",
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
};

const operationColumns = [
  "id",
  "code",
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
  "is_active",
  "created_at",
  "updated_at",
];

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
      .map(([key, value]) => [toColumn(key), key.endsWith("At") || key === "eta" || key === "returnLimit" ? toDate(value) : value]),
  );
}

async function audit(action: string, entity: string, entityId: string | null, operationId: string | null, changes?: unknown) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO importadex_audit_logs (id, action, entity, entity_id, operation_id, changes)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    randomUUID(),
    action,
    entity,
    entityId,
    operationId,
    JSON.stringify(changes ?? {}),
  );
}

async function insert(table: string, payload: Record<string, unknown>) {
  const id = randomUUID();
  const data = normalizePayload({ id, ...payload });
  const columns = Object.keys(data);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const values = Object.values(data);
  const rows = await prisma.$queryRawUnsafe<unknown[]>(
    `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")})
     VALUES (${placeholders}) RETURNING *`,
    ...values,
  );
  return rows[0];
}

async function patch(table: string, id: string, payload: Record<string, unknown>) {
  const data = normalizePayload(payload);
  const columns = Object.keys(data);
  if (columns.length === 0) return findById(table, id);
  const assignments = columns.map((column, index) => `"${column}" = $${index + 2}`).join(", ");
  const rows = await prisma.$queryRawUnsafe<unknown[]>(
    `UPDATE ${table} SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
    id,
    ...Object.values(data),
  );
  return rows[0] ?? null;
}

async function findById(table: string, id: string) {
  const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM ${table} WHERE id = $1`, id);
  return rows[0] ?? null;
}

export const importadexService = {
  async listOperations(filters: { q?: string; status?: string; mode?: string }) {
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
      clauses.push(`(code ILIKE $${values.length} OR client_name ILIKE $${values.length} OR reference ILIKE $${values.length})`);
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

  async createOperation(payload: Record<string, unknown>) {
    const code = payload.code ?? `IMPX-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const operation = await insert("importadex_operations", { ...payload, code });
    const operationId = (operation as { id: string }).id;
    await audit("CREATE", "operation", operationId, operationId, operation);
    await insert("importadex_events", {
      operationId,
      event: "Operacion creada",
      owner: "system",
      location: payload.origin,
    });
    return this.getOperation(operationId);
  },

  async updateOperation(id: string, payload: Record<string, unknown>) {
    const operation = await patch("importadex_operations", id, payload);
    await audit("UPDATE", "operation", id, id, payload);
    return operation;
  },

  async updateStatus(id: string, status: string, note?: string) {
    await patch("importadex_operations", id, { status });
    await insert("importadex_events", {
      operationId: id,
      event: `Cambio de estado a ${status}`,
      owner: "system",
      location: note ?? null,
    });
    await audit("STATUS_CHANGE", "operation", id, id, { status, note });
    return this.getOperation(id);
  },

  async listTable(key: TableKey) {
    return prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM ${tableMap[key]} ORDER BY created_at DESC`);
  },

  async createTable(key: TableKey, payload: Record<string, unknown>) {
    const item = await insert(tableMap[key], payload);
    await audit("CREATE", key, (item as { id: string }).id, payload.operationId as string, item);
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

  async createAttachments(operationId: string, files: UploadedFile[]) {
    const operation = await findById("importadex_operations", operationId);
    if (!operation) return null;

    const attachments = await Promise.all(
      files.map((file) =>
        insert("importadex_attachments", {
          operationId,
          fileName: file.originalName || file.fileName,
          fileUrl: file.url,
          fileType: file.mimeType,
        }),
      ),
    );

    await insert("importadex_events", {
      operationId,
      event: "Evidencia cargada",
      owner: "system",
      location: files.map((file) => file.originalName || file.fileName).join(", "),
    });
    await audit("CREATE", "attachments", null, operationId, attachments);

    return this.getOperation(operationId);
  },

  async updateTable(key: TableKey, id: string, payload: Record<string, unknown>) {
    const item = await patch(tableMap[key], id, payload);
    await audit("UPDATE", key, id, (item as { operation_id?: string } | null)?.operation_id ?? null, payload);
    return item;
  },

  async listEvents(operationId: string) {
    return prisma.$queryRawUnsafe<unknown[]>(
      "SELECT * FROM importadex_events WHERE operation_id = $1 ORDER BY event_date ASC",
      operationId,
    );
  },

  async createEvent(operationId: string, payload: Record<string, unknown>) {
    const event = await insert("importadex_events", { ...payload, operationId });
    await audit("CREATE", "event", (event as { id: string }).id, operationId, event);
    return event;
  },

  async listComments(operationId: string) {
    return prisma.$queryRawUnsafe<unknown[]>(
      "SELECT * FROM importadex_comments WHERE operation_id = $1 ORDER BY created_at ASC",
      operationId,
    );
  },

  async createComment(operationId: string, payload: Record<string, unknown>) {
    const comment = await insert("importadex_comments", { ...payload, operationId });
    await audit("CREATE", "comment", (comment as { id: string }).id, operationId, comment);
    return comment;
  },

  async catalogs() {
    return prisma.$queryRawUnsafe<unknown[]>(
      "SELECT \"group\", value, label FROM importadex_catalogs WHERE active = true ORDER BY \"group\", label",
    );
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
    const byType = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT operation_type, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY operation_type
       ORDER BY operation_type`,
    );
    const byMode = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT transport_mode, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY transport_mode
       ORDER BY transport_mode`,
    );
    return {
      byType,
      byMode,
      averages: {
        customsClearanceDays: 0,
        deliveryDays: 0,
      },
    };
  },
};
