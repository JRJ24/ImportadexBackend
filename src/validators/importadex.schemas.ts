import { z } from "zod";

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
});

export const operationPatchSchema = operationSchema.partial();

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
