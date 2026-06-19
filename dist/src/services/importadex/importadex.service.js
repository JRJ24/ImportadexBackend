"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importadexService = exports.ImportadexServiceError = void 0;
const crypto_1 = require("crypto");
const connectionDB_1 = require("../../config/connectionDB");
class ImportadexServiceError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.ImportadexServiceError = ImportadexServiceError;
const tableMap = {
    containers: "importadex_containers",
    "customs-files": "importadex_customs_files",
    incidents: "importadex_incidents",
    documents: "importadex_documents",
    attachments: "importadex_attachments",
};
const tablesWithUpdatedAt = new Set([
    "containers",
    "customs-files",
    "incidents",
    "documents",
]);
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
    documentId: "document_id",
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
const catalogOptionGroups = new Set([
    "origin",
    "destination",
    "port_airport",
    "carrier",
    "customs_status",
    "document_type",
]);
function normalizeCatalogValue(label) {
    return label
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}
function assertCatalogOptionGroup(group) {
    if (!catalogOptionGroups.has(group)) {
        throw new ImportadexServiceError(400, "Grupo de catalogo no soportado");
    }
}
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
async function audit(action, entity, entityId, operationId, changes, db = connectionDB_1.prisma) {
    await db.$executeRawUnsafe(`INSERT INTO importadex_audit_logs (id, action, entity, entity_id, operation_id, changes)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, (0, crypto_1.randomUUID)(), action, entity, entityId, operationId, JSON.stringify(changes ?? {}));
}
async function upsertCatalogOption(group, label, db = connectionDB_1.prisma) {
    if (typeof label !== "string")
        return null;
    const cleanLabel = label.trim();
    if (!cleanLabel)
        return null;
    const value = normalizeCatalogValue(cleanLabel);
    const rows = await db.$queryRawUnsafe(`INSERT INTO importadex_catalogs (id, "group", value, label, active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT ("group", value) DO UPDATE SET label = EXCLUDED.label, active = true
     RETURNING "group", value, label`, (0, crypto_1.randomUUID)(), group, value, cleanLabel);
    if (group === "carrier") {
        await db.$executeRawUnsafe(`INSERT INTO importadex_carriers (id, name, active)
       VALUES ($1, $2, true)
       ON CONFLICT (name) DO UPDATE SET active = true`, (0, crypto_1.randomUUID)(), cleanLabel);
    }
    return rows[0] ?? { group, value, label: cleanLabel };
}
async function ensureApprovedClient(clientName) {
    const cleanClientName = typeof clientName === "string" ? clientName.trim() : "";
    if (!cleanClientName) {
        throw new ImportadexServiceError(400, "Selecciona un cliente aprobado");
    }
    const rows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT id
     FROM importadex_clients
     WHERE active = true
       AND review_status = 'APPROVED'
       AND (
         name = $1 OR
         CONCAT(name, CASE WHEN last_name IS NULL OR BTRIM(last_name) = '' THEN '' ELSE CONCAT(' ', last_name) END) = $1
       )
     LIMIT 1`, cleanClientName);
    if (!rows[0]) {
        throw new ImportadexServiceError(400, "La operacion requiere un cliente aprobado");
    }
}
async function insert(table, payload, db = connectionDB_1.prisma) {
    const id = (0, crypto_1.randomUUID)();
    const data = normalizePayload({ id, ...payload });
    const columns = Object.keys(data);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const values = Object.values(data);
    const rows = await db.$queryRawUnsafe(`INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")})
     VALUES (${placeholders}) RETURNING *`, ...values);
    return rows[0];
}
async function patch(table, id, payload, db = connectionDB_1.prisma) {
    const data = normalizePayload(payload);
    const columns = Object.keys(data);
    if (columns.length === 0)
        return findById(table, id, db);
    const assignments = columns
        .map((column, index) => `"${column}" = $${index + 2}`)
        .join(", ");
    const rows = await db.$queryRawUnsafe(`UPDATE ${table} SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`, id, ...Object.values(data));
    return rows[0] ?? null;
}
async function findById(table, id, db = connectionDB_1.prisma) {
    const rows = await db.$queryRawUnsafe(`SELECT * FROM ${table} WHERE id = $1`, id);
    return rows[0] ?? null;
}
function getTransportDocumentName(transportMode) {
    if (transportMode === "AIR")
        return "Guia aerea AWB";
    if (transportMode === "LAND")
        return "Carta porte terrestre";
    return "Conocimiento de embarque BL";
}
function buildDefaultDocuments(operationPayload) {
    return [
        { name: "Factura comercial", type: "COMMERCIAL_INVOICE", status: "PENDING", owner: "Cliente", url: null },
        { name: "Packing list", type: "PACKING_LIST", status: "PENDING", owner: "Cliente", url: null },
        { name: getTransportDocumentName(operationPayload.transportMode), type: "TRANSPORT_DOCUMENT", status: "PENDING", owner: "Carrier", url: null },
        { name: "Declaracion aduanal", type: "CUSTOMS_DECLARATION", status: "PENDING", owner: "Aduanas", url: null },
        { name: "Permisos y certificados", type: "PERMITS", status: "PENDING", owner: "Cliente", url: null },
        { name: "Comprobante de pago", type: "PAYMENT_PROOF", status: "PENDING", owner: "Cliente", url: null },
    ];
}
function documentProgressValue(status) {
    const normalizedStatus = String(status ?? "PENDING").trim().toUpperCase();
    if (["APPROVED", "RECEIVED", "VALIDATED", "APROBADO", "RECIBIDO", "VALIDADO"].includes(normalizedStatus))
        return 100;
    if (["IN_REVIEW", "REVIEW", "EN_REVISION", "EN REVISION", "REVISION"].includes(normalizedStatus))
        return 50;
    return 0;
}
async function recalculateDocumentProgress(operationId, db = connectionDB_1.prisma) {
    const documents = await db.$queryRawUnsafe(`SELECT status FROM importadex_documents WHERE operation_id = $1`, operationId);
    const progress = documents.length
        ? Math.round(documents.reduce((total, document) => total + documentProgressValue(document.status), 0) / documents.length)
        : 0;
    await db.$executeRawUnsafe(`UPDATE importadex_operations SET progress = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, operationId, progress);
    return progress;
}
function asRecordArray(value) {
    return Array.isArray(value) ? value.filter((item) => Boolean(item) && typeof item === "object") : [];
}
function asRecord(value) {
    return value && typeof value === "object" ? value : null;
}
function getInitialContainers(container, containers, operationPayload, code) {
    const containerRows = asRecordArray(containers);
    const legacyContainer = asRecord(container);
    if (containerRows.length)
        return containerRows;
    if (legacyContainer)
        return [legacyContainer];
    if (operationPayload.cargoType !== "CONTAINERIZED")
        return [];
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
        const { container, containers, documents, customsFile, incidents, ...operationPayload } = payload;
        await ensureApprovedClient(operationPayload.clientName);
        const code = operationPayload.code ??
            `IMPX-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
        const operationId = await connectionDB_1.prisma.$transaction(async (tx) => {
            await upsertCatalogOption("origin", operationPayload.origin, tx);
            await upsertCatalogOption("destination", operationPayload.destination, tx);
            await upsertCatalogOption("port_airport", operationPayload.port, tx);
            await upsertCatalogOption("carrier", operationPayload.carrier, tx);
            await upsertCatalogOption("customs_status", operationPayload.customsStatus, tx);
            const operation = await insert("importadex_operations", {
                ...operationPayload,
                code,
                progress: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            }, tx);
            const createdOperationId = operation.id;
            const initialContainers = getInitialContainers(container, containers, operationPayload, code);
            for (const initialContainer of initialContainers) {
                const containerNumber = typeof initialContainer.number === "string" && initialContainer.number.trim()
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
            }, tx);
            await insert("importadex_events", {
                operation_id: createdOperationId,
                event: "Operacion creada con checklist documental inicial",
                owner: "system",
                location: operationPayload.origin,
                created_at: new Date(),
            }, tx);
            return createdOperationId;
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
        const operationId = typeof payload.operationId === "string" ? payload.operationId : undefined;
        if (operationId && !(await findById("importadex_operations", operationId))) {
            throw new ImportadexServiceError(404, "Operation not found");
        }
        const item = await insert(tableMap[key], tablesWithUpdatedAt.has(key)
            ? { ...payload, createdAt: new Date(), updatedAt: new Date() }
            : payload);
        const itemOperationId = item.operation_id ?? operationId;
        if (key === "documents" && itemOperationId) {
            await upsertCatalogOption("document_type", item.name);
            await recalculateDocumentProgress(itemOperationId);
            await insert("importadex_events", {
                operationId: itemOperationId,
                event: `Documento creado: ${item.name ?? "Documento"}`,
                owner: "system",
                location: item.status ?? "PENDING",
            });
        }
        if (key === "incidents" && itemOperationId) {
            await insert("importadex_events", {
                operationId: itemOperationId,
                event: `Incidencia registrada: ${item.type ?? "Incidencia"}`,
                owner: item.owner ?? "system",
                location: item.status ?? "OPEN",
            });
        }
        await audit("CREATE", key, item.id, itemOperationId ?? null, item);
        return item;
    },
    async listAttachments(operationId) {
        return connectionDB_1.prisma.$queryRawUnsafe(`SELECT *
       FROM importadex_attachments
       WHERE operation_id = $1
       ORDER BY created_at DESC`, operationId);
    },
    async createAttachments(operationId, files, documentId) {
        const operation = await findById("importadex_operations", operationId);
        if (!operation)
            return null;
        const documentRows = documentId
            ? await connectionDB_1.prisma.$queryRawUnsafe(`SELECT id, name, status FROM importadex_documents WHERE id = $1 AND operation_id = $2`, documentId, operationId)
            : [];
        const document = documentRows[0] ?? null;
        if (documentId && !document)
            return null;
        const attachments = await Promise.all(files.map((file) => insert("importadex_attachments", {
            operationId,
            documentId: document?.id ?? null,
            fileName: file.originalName || file.fileName,
            fileUrl: file.url,
            fileType: file.mimeType,
        })));
        if (document) {
            await connectionDB_1.prisma.$executeRawUnsafe(`UPDATE importadex_documents
         SET status = CASE WHEN status = 'APPROVED' THEN status ELSE 'RECEIVED' END,
             url = COALESCE($2, url),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, document.id, files[0]?.url ?? null);
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
        await audit("CREATE", "attachments", null, operationId, { documentId: document?.id ?? null, attachments });
        return this.getOperation(operationId);
    },
    async updateTable(key, id, payload) {
        const item = await patch(tableMap[key], id, payload);
        const operationId = item?.operation_id ?? null;
        if (key === "documents" && operationId) {
            await recalculateDocumentProgress(operationId);
            await insert("importadex_events", {
                operationId,
                event: `Documento actualizado: ${item.name ?? "Documento"}`,
                owner: "system",
                location: item.status ?? null,
            });
        }
        if (key === "incidents" && operationId) {
            await insert("importadex_events", {
                operationId,
                event: `Incidencia actualizada: ${item.type ?? "Incidencia"}`,
                owner: item.owner ?? "system",
                location: item.status ?? null,
            });
        }
        await audit("UPDATE", key, id, operationId, payload);
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
        return connectionDB_1.prisma.$queryRawUnsafe(`WITH option_rows AS (
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
      )
      SELECT DISTINCT ON ("group", LOWER(label)) "group", value, label
      FROM option_rows
      ORDER BY "group", LOWER(label), label`);
    },
    async createCatalogOption(payload) {
        assertCatalogOptionGroup(payload.group);
        return upsertCatalogOption(payload.group, payload.label);
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
        const summaryRows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT
        COUNT(*)::int AS total_operations,
        COUNT(*) FILTER (WHERE status NOT IN ('CLOSED', 'CANCELLED'))::int AS open_operations,
        COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_operations,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_operations,
        COALESCE(ROUND(AVG(progress))::int, 0)::int AS average_document_progress,
        COUNT(*) FILTER (WHERE eta IS NOT NULL AND eta < CURRENT_TIMESTAMP AND status NOT IN ('CLOSED', 'CANCELLED'))::int AS eta_expired,
        COALESCE(ROUND((AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at)) / 86400) FILTER (WHERE status NOT IN ('CLOSED', 'CANCELLED')))::numeric, 1), 0) AS average_open_age_days
       FROM importadex_operations
       WHERE is_active = true`);
        const documentRows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE UPPER(status) = 'PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE UPPER(status) IN ('IN_REVIEW', 'REVIEW', 'EN_REVISION', 'EN REVISION'))::int AS in_review,
        COUNT(*) FILTER (WHERE UPPER(status) = 'RECEIVED')::int AS received,
        COUNT(*) FILTER (WHERE UPPER(status) IN ('APPROVED', 'VALIDATED'))::int AS approved,
        COALESCE(ROUND((COUNT(*) FILTER (WHERE UPPER(status) IN ('RECEIVED', 'APPROVED', 'VALIDATED'))::numeric / NULLIF(COUNT(*), 0)) * 100)::int, 0)::int AS compliance_rate,
        (SELECT COUNT(DISTINCT operation_id)::int FROM importadex_documents WHERE UPPER(status) NOT IN ('RECEIVED', 'APPROVED', 'VALIDATED')) AS operations_with_pending
       FROM importadex_documents`);
        const incidentRows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked,
        COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical,
        COUNT(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED'))::int AS active
       FROM importadex_incidents`);
        const customsRows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE UPPER(status) LIKE '%PEND%')::int AS pending,
        COUNT(*) FILTER (WHERE UPPER(status) LIKE '%REVIEW%' OR UPPER(status) LIKE '%REVISION%')::int AS in_review,
        COUNT(*) FILTER (WHERE released_at IS NOT NULL OR UPPER(status) LIKE '%RELEASE%' OR UPPER(status) LIKE '%LIBER%' OR UPPER(status) LIKE '%LEVANTE%' OR UPPER(status) = 'APPROVED')::int AS released,
        COALESCE(ROUND((AVG(EXTRACT(EPOCH FROM (released_at - submitted_at)) / 86400) FILTER (WHERE submitted_at IS NOT NULL AND released_at IS NOT NULL))::numeric, 1), 0) AS average_release_days
       FROM importadex_customs_files`);
        const containerRows = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE UPPER(status) LIKE '%RETURN%' OR UPPER(status) LIKE '%DEVOL%')::int AS pending_return,
        COUNT(*) FILTER (WHERE return_limit IS NOT NULL AND return_limit < CURRENT_TIMESTAMP AND UPPER(status) NOT LIKE '%RETURNED%' AND UPPER(status) NOT LIKE '%DEVUELTO%')::int AS expired_returns,
        COUNT(*) FILTER (WHERE return_limit IS NOT NULL AND return_limit >= CURRENT_TIMESTAMP AND return_limit <= CURRENT_TIMESTAMP + INTERVAL '3 days')::int AS due_soon,
        COUNT(*) FILTER (WHERE return_limit IS NULL)::int AS without_return_limit
       FROM importadex_containers`);
        const byType = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT operation_type AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY operation_type
       ORDER BY operation_type`);
        const byMode = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT transport_mode AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY transport_mode
       ORDER BY transport_mode`);
        const byStatus = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT status AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY status
       ORDER BY total DESC, status`);
        const documentsByStatus = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT status AS label, COUNT(*)::int AS total
       FROM importadex_documents
       GROUP BY status
       ORDER BY total DESC, status`);
        const incidentsBySeverity = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT severity AS label, COUNT(*)::int AS total
       FROM importadex_incidents
       GROUP BY severity
       ORDER BY total DESC, severity`);
        const incidentsByStatus = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT status AS label, COUNT(*)::int AS total
       FROM importadex_incidents
       GROUP BY status
       ORDER BY total DESC, status`);
        const customsByStatus = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT status AS label, COUNT(*)::int AS total
       FROM importadex_customs_files
       GROUP BY status
       ORDER BY total DESC, status`);
        const topClients = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT client_name AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY client_name
       ORDER BY total DESC, client_name
       LIMIT 8`);
        const monthlyOperations = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS label, COUNT(*)::int AS total
       FROM importadex_operations
       WHERE is_active = true
       GROUP BY date_trunc('month', created_at)
       ORDER BY label DESC
       LIMIT 12`);
        const riskOperations = await connectionDB_1.prisma.$queryRawUnsafe(`SELECT
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
       LIMIT 10`);
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
            riskOperations,
        };
    },
};
