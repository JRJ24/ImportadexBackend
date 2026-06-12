"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importadexService = void 0;
const crypto_1 = require("crypto");
const connectionDB_1 = require("../../config/connectionDB");
const tableMap = {
    containers: "importadex_containers",
    "customs-files": "importadex_customs_files",
    incidents: "importadex_incidents",
    documents: "importadex_documents",
    attachments: "importadex_attachments",
};
const columnMap = {
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
function toColumn(key) {
    return columnMap[key] ?? key;
}
function toDate(value) {
    return typeof value === "string" && value ? new Date(value) : value;
}
function normalizePayload(payload) {
    return Object.fromEntries(Object.entries(payload)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [
        toColumn(key),
        key.endsWith("At") || key === "eta" || key === "returnLimit"
            ? toDate(value)
            : value,
    ]));
}
async function audit(action, entity, entityId, operationId, changes) {
    await connectionDB_1.prisma.$executeRawUnsafe(`INSERT INTO importadex_audit_logs (id, action, entity, entity_id, operation_id, changes)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, (0, crypto_1.randomUUID)(), action, entity, entityId, operationId, JSON.stringify(changes ?? {}));
}
async function insert(table, payload) {
    const id = (0, crypto_1.randomUUID)();
    const data = normalizePayload({ id, ...payload });
    const columns = Object.keys(data);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const values = Object.values(data);
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")})
     VALUES (${placeholders}) RETURNING *`, ...values);
    return rows[0];
}
async function patch(table, id, payload) {
    const data = normalizePayload(payload);
    const columns = Object.keys(data);
    if (columns.length === 0)
        return findById(table, id);
    const assignments = columns
        .map((column, index) => `"${column}" = $${index + 2}`)
        .join(", ");
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`UPDATE ${table} SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`, id, ...Object.values(data));
    return rows[0] ?? null;
}
async function findById(table, id) {
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT * FROM ${table} WHERE id = $1`, id);
    return rows[0] ?? null;
}
exports.importadexService = {
    async listOperations(filters) {
        const clauses = [`is_active = true`];
        const values = [];
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
        return connectionDB_1.prisma.$queryRawUnsafe(`SELECT ${operationColumns.map((column) => `"${column}"`).join(", ")}
       FROM importadex_operations
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC`, ...values);
    },
    async getOperation(id) {
        const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT o.*,
        COALESCE((SELECT json_agg(c.*) FROM importadex_containers c WHERE c.operation_id = o.id), '[]') AS containers,
        COALESCE((SELECT json_agg(ci.*) FROM importadex_cargo_items ci WHERE ci.operation_id = o.id), '[]') AS cargo_items,
        COALESCE((SELECT json_agg(d.*) FROM importadex_documents d WHERE d.operation_id = o.id), '[]') AS documents,
        COALESCE((SELECT json_agg(cf.*) FROM importadex_customs_files cf WHERE cf.operation_id = o.id), '[]') AS customs_files,
        COALESCE((SELECT json_agg(i.*) FROM importadex_incidents i WHERE i.operation_id = o.id), '[]') AS incidents,
        COALESCE((SELECT json_agg(e.* ORDER BY e.event_date) FROM importadex_events e WHERE e.operation_id = o.id), '[]') AS events,
        COALESCE((SELECT json_agg(cm.* ORDER BY cm.created_at) FROM importadex_comments cm WHERE cm.operation_id = o.id), '[]') AS comments,
        COALESCE((SELECT json_agg(a.* ORDER BY a.created_at DESC) FROM importadex_attachments a WHERE a.operation_id = o.id), '[]') AS attachments
       FROM importadex_operations o
       WHERE o.id = $1 AND o.is_active = true`, id);
        return rows[0] ?? null;
    },
    async createOperation(payload) {
        const { container, ...operationPayload } = payload;
        const code = operationPayload.code ??
            `IMPX-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
        const operation = await insert("importadex_operations", {
            ...operationPayload,
            code,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const operationId = operation.id;
        if (operationPayload.cargoType === "CONTAINERIZED" && container && typeof container === "object") {
            const initialContainer = container;
            const containerNumber = typeof initialContainer.number === "string" && initialContainer.number.trim()
                ? initialContainer.number.trim()
                : `PEND-${String(code).replace(/[^a-zA-Z0-9-]/g, "").slice(-12)}`;
            await insert("importadex_containers", {
                operationId,
                number: containerNumber,
                type: initialContainer.type,
                seal: initialContainer.seal ?? null,
                carrier: initialContainer.carrier ?? operationPayload.carrier ?? null,
                freeDays: initialContainer.freeDays ?? 0,
                returnLimit: initialContainer.returnLimit ?? null,
                status: initialContainer.status ?? "TYPE_SELECTED",
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }
        await audit("CREATE", "operation", operationId, operationId, operation);
        await insert("importadex_events", {
            operation_id: operationId,
            event: "Operacion creada",
            owner: "system",
            location: operationPayload.origin,
            created_at: new Date(),
        });
        return this.getOperation(operationId);
    },
    async updateOperation(id, payload) {
        const operation = await patch("importadex_operations", id, payload);
        await audit("UPDATE", "operation", id, id, payload);
        return operation;
    },
    async updateStatus(id, status, note) {
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
    async listTable(key) {
        return connectionDB_1.prisma.$queryRawUnsafe(`SELECT * FROM ${tableMap[key]} ORDER BY created_at DESC`);
    },
    async createTable(key, payload) {
        const item = await insert(tableMap[key], payload);
        await audit("CREATE", key, item.id, payload.operationId, item);
        return item;
    },
    async listAttachments(operationId) {
        return connectionDB_1.prisma.$queryRawUnsafe(`SELECT *
       FROM importadex_attachments
       WHERE operation_id = $1
       ORDER BY created_at DESC`, operationId);
    },
    async createAttachments(operationId, files) {
        const operation = await findById("importadex_operations", operationId);
        if (!operation)
            return null;
        const attachments = await Promise.all(files.map((file) => insert("importadex_attachments", {
            operationId,
            fileName: file.originalName || file.fileName,
            fileUrl: file.url,
            fileType: file.mimeType,
        })));
        await insert("importadex_events", {
            operationId,
            event: "Evidencia cargada",
            owner: "system",
            location: files
                .map((file) => file.originalName || file.fileName)
                .join(", "),
        });
        await audit("CREATE", "attachments", null, operationId, attachments);
        return this.getOperation(operationId);
    },
    async updateTable(key, id, payload) {
        const item = await patch(tableMap[key], id, payload);
        await audit("UPDATE", key, id, item?.operation_id ?? null, payload);
        return item;
    },
    async listEvents(operationId) {
        return connectionDB_1.prisma.$queryRawUnsafe("SELECT * FROM importadex_events WHERE operation_id = $1 ORDER BY event_date ASC", operationId);
    },
    async createEvent(operationId, payload) {
        const event = await insert("importadex_events", {
            ...payload,
            operationId,
        });
        await audit("CREATE", "event", event.id, operationId, event);
        return event;
    },
    async listComments(operationId) {
        return connectionDB_1.prisma.$queryRawUnsafe("SELECT * FROM importadex_comments WHERE operation_id = $1 ORDER BY created_at ASC", operationId);
    },
    async createComment(operationId, payload) {
        const comment = await insert("importadex_comments", {
            ...payload,
            operationId,
        });
        await audit("CREATE", "comment", comment.id, operationId, comment);
        return comment;
    },
    async catalogs() {
        return connectionDB_1.prisma.$queryRawUnsafe('SELECT "group", value, label FROM importadex_catalogs WHERE active = true ORDER BY "group", label');
    },
    async dashboard() {
        const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT
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
       WHERE is_active = true`);
        return rows[0];
    },
    async reports() {
        const byType = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT operation_type, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY operation_type
       ORDER BY operation_type`);
        const byMode = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT transport_mode, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY transport_mode
       ORDER BY transport_mode`);
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
