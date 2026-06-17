"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importadexCatalogOptionSchema = exports.importadexClientReviewSchema = exports.importadexClientRegisterSchema = exports.patchSchemas = exports.attachmentSchema = exports.documentSchema = exports.incidentSchema = exports.customsFileSchema = exports.containerSchema = exports.commentSchema = exports.eventSchema = exports.statusSchema = exports.operationPatchSchema = exports.operationSchema = void 0;
const zod_1 = require("zod");
const formBoolean = zod_1.z.preprocess((value) => {
    if (typeof value === "boolean")
        return value;
    if (typeof value !== "string")
        return value;
    return ["1", "true", "si", "sí", "yes"].includes(value.trim().toLowerCase());
}, zod_1.z.boolean());
const typeClientSchema = zod_1.z.preprocess((value) => {
    if (typeof value !== "string")
        return value;
    const normalized = value.trim().toUpperCase();
    if (["CORPORATIVO", "CORPORATE", "CORPORATIVE"].includes(normalized))
        return "CORPORATIVE";
    return "PERSONAL";
}, zod_1.z.enum(["PERSONAL", "CORPORATIVE"]));
const typeIdentificationSchema = zod_1.z.preprocess((value) => {
    if (typeof value !== "string")
        return value;
    const normalized = value.trim().toUpperCase();
    if (["RNC", "REGISTRO"].includes(normalized))
        return "RNC";
    return "DNI";
}, zod_1.z.enum(["DNI", "RNC"]));
const operationContainerSchema = zod_1.z.object({
    number: zod_1.z.string().trim().min(1).optional().nullable(),
    type: zod_1.z.string().trim().min(1),
    seal: zod_1.z.string().trim().min(1).optional().nullable(),
    carrier: zod_1.z.string().trim().min(1).optional().nullable(),
    freeDays: zod_1.z.number().int().min(0).optional(),
    returnLimit: zod_1.z.string().datetime().optional().nullable(),
    status: zod_1.z.string().trim().min(1).optional(),
});
const operationDocumentSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    type: zod_1.z.string().trim().min(1),
    status: zod_1.z.string().trim().min(1).optional(),
    owner: zod_1.z.string().trim().optional().nullable(),
    url: zod_1.z.string().url().optional().nullable(),
});
const operationCustomsFileSchema = zod_1.z.object({
    declarationNo: zod_1.z.string().trim().optional().nullable(),
    regime: zod_1.z.string().trim().optional().nullable(),
    channel: zod_1.z.string().trim().optional().nullable(),
    status: zod_1.z.string().trim().optional(),
    responsible: zod_1.z.string().trim().optional().nullable(),
    submittedAt: zod_1.z.string().datetime().optional().nullable(),
    releasedAt: zod_1.z.string().datetime().optional().nullable(),
});
const operationIncidentSchema = zod_1.z.object({
    type: zod_1.z.string().trim().min(2),
    severity: zod_1.z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    status: zod_1.z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CANCELLED"]).optional(),
    owner: zod_1.z.string().trim().optional().nullable(),
    description: zod_1.z.string().trim().optional().nullable(),
    dueAt: zod_1.z.string().datetime().optional().nullable(),
    resolvedAt: zod_1.z.string().datetime().optional().nullable(),
});
exports.operationSchema = zod_1.z.object({
    code: zod_1.z.string().min(3).optional(),
    clientName: zod_1.z.string().min(2),
    operationType: zod_1.z.enum(["IMPORT", "EXPORT", "TRANSIT", "CUSTOMS_CLEARANCE", "LOCAL_TRANSPORT"]),
    transportMode: zod_1.z.enum(["SEA", "AIR", "LAND", "MULTIMODAL"]),
    cargoType: zod_1.z.enum(["CONTAINERIZED", "LOOSE", "PALLETIZED", "NON_PALLETIZED", "LCL", "BREAKBULK"]),
    status: zod_1.z
        .enum([
        "DRAFT",
        "OPEN",
        "IN_TRANSIT_SEA",
        "IN_TRANSIT_AIR",
        "IN_TRANSIT_LAND",
        "IN_CUSTOMS",
        "PENDING_DOCUMENTS",
        "READY_FOR_DELIVERY",
        "DELIVERED",
        "CLOSED",
        "CANCELLED",
    ])
        .optional(),
    customsStatus: zod_1.z.string().optional().nullable(),
    priority: zod_1.z.string().optional(),
    origin: zod_1.z.string().min(2),
    destination: zod_1.z.string().min(2),
    port: zod_1.z.string().optional().nullable(),
    carrier: zod_1.z.string().optional().nullable(),
    reference: zod_1.z.string().optional().nullable(),
    eta: zod_1.z.string().datetime().optional().nullable(),
    progress: zod_1.z.number().int().min(0).max(100).optional(),
    container: operationContainerSchema.optional().nullable(),
    containers: zod_1.z.array(operationContainerSchema).optional(),
    documents: zod_1.z.array(operationDocumentSchema).optional(),
    customsFile: operationCustomsFileSchema.optional().nullable(),
    incidents: zod_1.z.array(operationIncidentSchema).optional(),
});
exports.operationPatchSchema = exports.operationSchema.omit({ container: true, containers: true, documents: true, customsFile: true, incidents: true }).partial();
exports.statusSchema = zod_1.z.object({
    status: exports.operationSchema.shape.status.unwrap(),
    note: zod_1.z.string().optional(),
});
exports.eventSchema = zod_1.z.object({
    event: zod_1.z.string().min(2),
    owner: zod_1.z.string().optional().nullable(),
    location: zod_1.z.string().optional().nullable(),
    eventDate: zod_1.z.string().datetime().optional(),
});
exports.commentSchema = zod_1.z.object({
    body: zod_1.z.string().min(1),
    author: zod_1.z.string().optional().nullable(),
});
exports.containerSchema = zod_1.z.object({
    operationId: zod_1.z.string().min(1),
    number: zod_1.z.string().min(3),
    type: zod_1.z.string().min(1),
    seal: zod_1.z.string().optional().nullable(),
    carrier: zod_1.z.string().optional().nullable(),
    freeDays: zod_1.z.number().int().min(0).optional(),
    returnLimit: zod_1.z.string().datetime().optional().nullable(),
    status: zod_1.z.string().optional(),
});
exports.customsFileSchema = zod_1.z.object({
    operationId: zod_1.z.string().min(1),
    declarationNo: zod_1.z.string().optional().nullable(),
    regime: zod_1.z.string().optional().nullable(),
    channel: zod_1.z.string().optional().nullable(),
    status: zod_1.z.string().optional(),
    responsible: zod_1.z.string().optional().nullable(),
    submittedAt: zod_1.z.string().datetime().optional().nullable(),
    releasedAt: zod_1.z.string().datetime().optional().nullable(),
});
exports.incidentSchema = zod_1.z.object({
    operationId: zod_1.z.string().min(1),
    type: zod_1.z.string().min(2),
    severity: zod_1.z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    status: zod_1.z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CANCELLED"]).optional(),
    owner: zod_1.z.string().optional().nullable(),
    description: zod_1.z.string().optional().nullable(),
    dueAt: zod_1.z.string().datetime().optional().nullable(),
    resolvedAt: zod_1.z.string().datetime().optional().nullable(),
});
exports.documentSchema = zod_1.z.object({
    operationId: zod_1.z.string().min(1),
    name: zod_1.z.string().min(2),
    type: zod_1.z.string().min(1),
    status: zod_1.z.string().optional(),
    owner: zod_1.z.string().optional().nullable(),
    url: zod_1.z.string().url().optional().nullable(),
});
exports.attachmentSchema = zod_1.z.object({
    operationId: zod_1.z.string().min(1),
    documentId: zod_1.z.string().min(1).optional().nullable(),
    fileName: zod_1.z.string().min(1),
    fileUrl: zod_1.z.string().url(),
    fileType: zod_1.z.string().optional().nullable(),
});
exports.patchSchemas = {
    containers: exports.containerSchema.partial().omit({ operationId: true }),
    "customs-files": exports.customsFileSchema.partial().omit({ operationId: true }),
    incidents: exports.incidentSchema.partial().omit({ operationId: true }),
    documents: exports.documentSchema.partial().omit({ operationId: true }),
    attachments: exports.attachmentSchema.partial().omit({ operationId: true }),
};
exports.importadexClientRegisterSchema = zod_1.z.object({
    type: typeClientSchema,
    name: zod_1.z.string().trim().min(2),
    lastName: zod_1.z.string().trim().optional().nullable(),
    adress: zod_1.z.string().trim().min(2),
    typeIdentification: typeIdentificationSchema,
    identification: zod_1.z.string().trim().min(3),
    gender: zod_1.z.string().trim().optional().nullable(),
    birthDate: zod_1.z.string().trim().optional().nullable(),
    phoneHomeOffice: zod_1.z.string().trim().min(3),
    phonePersonal: zod_1.z.string().trim().optional().nullable(),
    email: zod_1.z.string().trim().email().transform((email) => email.toLowerCase()),
    feedBack: zod_1.z.string().trim().optional().nullable(),
    hasDgaToken: formBoolean,
});
exports.importadexClientReviewSchema = zod_1.z.object({
    feedBack: zod_1.z.string().trim().optional().nullable(),
});
exports.importadexCatalogOptionSchema = zod_1.z.object({
    group: zod_1.z.enum(["origin", "destination", "port_airport", "carrier", "customs_status", "document_type"]),
    label: zod_1.z.string().trim().min(2),
});
