import { z } from "zod";

const formBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;

  return ["1", "true", "si", "sí", "yes"].includes(value.trim().toLowerCase());
}, z.boolean());

const typeClientSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toUpperCase();
  if (["CORPORATIVO", "CORPORATE", "CORPORATIVE"].includes(normalized)) return "CORPORATIVE";
  return "PERSONAL";
}, z.enum(["PERSONAL", "CORPORATIVE"]));

const typeIdentificationSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toUpperCase();
  if (["RNC", "REGISTRO"].includes(normalized)) return "RNC";
  return "DNI";
}, z.enum(["DNI", "RNC"]));

const operationContainerSchema = z.object({
  number: z.string().trim().min(1).optional().nullable(),
  type: z.string().trim().min(1),
  seal: z.string().trim().min(1).optional().nullable(),
  carrier: z.string().trim().min(1).optional().nullable(),
  freeDays: z.number().int().min(0).optional(),
  returnLimit: z.string().datetime().optional().nullable(),
  status: z.string().trim().min(1).optional(),
});

const operationDocumentSchema = z.object({
  name: z.string().trim().min(2),
  type: z.string().trim().min(1),
  status: z.string().trim().min(1).optional(),
  owner: z.string().trim().optional().nullable(),
  url: z.string().url().optional().nullable(),
});

const operationCustomsFileSchema = z.object({
  declarationNo: z.string().trim().optional().nullable(),
  regime: z.string().trim().optional().nullable(),
  channel: z.string().trim().optional().nullable(),
  status: z.string().trim().optional(),
  responsible: z.string().trim().optional().nullable(),
  submittedAt: z.string().datetime().optional().nullable(),
  releasedAt: z.string().datetime().optional().nullable(),
});

const operationIncidentSchema = z.object({
  type: z.string().trim().min(2),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CANCELLED"]).optional(),
  owner: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  resolvedAt: z.string().datetime().optional().nullable(),
});

export const operationSchema = z.object({
  code: z.string().min(3).optional(),
  clientName: z.string().min(2),
  operationType: z.enum(["IMPORT", "EXPORT", "TRANSIT", "CUSTOMS_CLEARANCE", "LOCAL_TRANSPORT"]),
  transportMode: z.enum(["SEA", "AIR", "LAND", "MULTIMODAL"]),
  cargoType: z.enum(["CONTAINERIZED", "LOOSE", "PALLETIZED", "NON_PALLETIZED", "LCL", "BREAKBULK"]),
  status: z
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
  customsStatus: z.string().optional().nullable(),
  priority: z.string().optional(),
  origin: z.string().min(2),
  destination: z.string().min(2),
  port: z.string().optional().nullable(),
  carrier: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  eta: z.string().datetime().optional().nullable(),
  progress: z.number().int().min(0).max(100).optional(),
  container: operationContainerSchema.optional().nullable(),
  containers: z.array(operationContainerSchema).optional(),
  documents: z.array(operationDocumentSchema).optional(),
  customsFile: operationCustomsFileSchema.optional().nullable(),
  incidents: z.array(operationIncidentSchema).optional(),
});

export const operationPatchSchema = operationSchema.omit({ container: true, containers: true, documents: true, customsFile: true, incidents: true }).partial();

export const statusSchema = z.object({
  status: operationSchema.shape.status.unwrap(),
  note: z.string().optional(),
});

export const eventSchema = z.object({
  event: z.string().min(2),
  owner: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  eventDate: z.string().datetime().optional(),
});

export const commentSchema = z.object({
  body: z.string().min(1),
  author: z.string().optional().nullable(),
});

export const containerSchema = z.object({
  operationId: z.string().min(1),
  number: z.string().min(3),
  type: z.string().min(1),
  seal: z.string().optional().nullable(),
  carrier: z.string().optional().nullable(),
  freeDays: z.number().int().min(0).optional(),
  returnLimit: z.string().datetime().optional().nullable(),
  status: z.string().optional(),
});

export const customsFileSchema = z.object({
  operationId: z.string().min(1),
  declarationNo: z.string().optional().nullable(),
  regime: z.string().optional().nullable(),
  channel: z.string().optional().nullable(),
  status: z.string().optional(),
  responsible: z.string().optional().nullable(),
  submittedAt: z.string().datetime().optional().nullable(),
  releasedAt: z.string().datetime().optional().nullable(),
});

export const incidentSchema = z.object({
  operationId: z.string().min(1),
  type: z.string().min(2),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CANCELLED"]).optional(),
  owner: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  resolvedAt: z.string().datetime().optional().nullable(),
});

export const documentSchema = z.object({
  operationId: z.string().min(1),
  name: z.string().min(2),
  type: z.string().min(1),
  status: z.string().optional(),
  owner: z.string().optional().nullable(),
  url: z.string().url().optional().nullable(),
});

export const attachmentSchema = z.object({
  operationId: z.string().min(1),
  documentId: z.string().min(1).optional().nullable(),
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  fileType: z.string().optional().nullable(),
});

export const patchSchemas = {
  containers: containerSchema.partial().omit({ operationId: true }),
  "customs-files": customsFileSchema.partial().omit({ operationId: true }),
  incidents: incidentSchema.partial().omit({ operationId: true }),
  documents: documentSchema.partial().omit({ operationId: true }),
  attachments: attachmentSchema.partial().omit({ operationId: true }),
};

export const importadexClientRegisterSchema = z.object({
  type: typeClientSchema,
  name: z.string().trim().min(2),
  lastName: z.string().trim().optional().nullable(),
  adress: z.string().trim().min(2),
  typeIdentification: typeIdentificationSchema,
  identification: z.string().trim().min(3),
  gender: z.string().trim().optional().nullable(),
  birthDate: z.string().trim().optional().nullable(),
  phoneHomeOffice: z.string().trim().min(3),
  phonePersonal: z.string().trim().optional().nullable(),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  discoverySource: z.string().trim().optional().nullable(),
  feedBack: z.string().trim().optional().nullable(),
  hasDgaToken: formBoolean,
});

export const importadexClientReviewSchema = z.object({
  feedBack: z.string().trim().optional().nullable(),
});

export const importadexCatalogOptionSchema = z.object({
  group: z.enum(["origin", "destination", "port_airport", "carrier", "customs_status", "document_type", "client_source"]),
  label: z.string().trim().min(2),
});

export const importadexEmailTestSchema = z.object({
  to: z.string().trim().email().transform((email) => email.toLowerCase()),
});

export const importadexClientPortalLoginSchema = z.object({
  identification: z.string().trim().min(3),
});

export const importadexClientPortalOtpSchema = z.object({
  identification: z.string().trim().min(3),
  code: z.string().trim().regex(/^\d{6}$/, "Codigo OTP invalido"),
});

export const importadexClientPortalAttachmentSchema = z.object({
  documentId: z.string().trim().min(1).optional().nullable(),
});
