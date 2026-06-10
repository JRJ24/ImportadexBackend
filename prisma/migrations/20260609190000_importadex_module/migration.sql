CREATE TYPE "ImportadexOperationType" AS ENUM ('IMPORT', 'EXPORT', 'TRANSIT', 'CUSTOMS_CLEARANCE', 'LOCAL_TRANSPORT');
CREATE TYPE "ImportadexTransportMode" AS ENUM ('SEA', 'AIR', 'LAND', 'MULTIMODAL');
CREATE TYPE "ImportadexCargoType" AS ENUM ('CONTAINERIZED', 'LOOSE', 'PALLETIZED', 'NON_PALLETIZED', 'LCL', 'BREAKBULK');
CREATE TYPE "ImportadexOperationStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_TRANSIT_SEA', 'IN_TRANSIT_AIR', 'IN_TRANSIT_LAND', 'IN_CUSTOMS', 'PENDING_DOCUMENTS', 'READY_FOR_DELIVERY', 'DELIVERED', 'CLOSED', 'CANCELLED');
CREATE TYPE "ImportadexIncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CANCELLED');
CREATE TYPE "ImportadexSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "importadex_operations" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "client_name" TEXT NOT NULL,
  "operation_type" "ImportadexOperationType" NOT NULL,
  "transport_mode" "ImportadexTransportMode" NOT NULL,
  "cargo_type" "ImportadexCargoType" NOT NULL,
  "status" "ImportadexOperationStatus" NOT NULL DEFAULT 'OPEN',
  "customs_status" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "origin" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "port" TEXT,
  "carrier" TEXT,
  "reference" TEXT,
  "eta" TIMESTAMP(3),
  "progress" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "importadex_operations_code_key" ON "importadex_operations"("code");

CREATE TABLE "importadex_shipments" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "etd" TIMESTAMP(3),
  "eta" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_shipments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_containers" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "seal" TEXT,
  "carrier" TEXT,
  "free_days" INTEGER NOT NULL DEFAULT 0,
  "return_limit" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'REGISTERED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_containers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_cargo_items" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "package_type" TEXT NOT NULL,
  "pieces" INTEGER NOT NULL DEFAULT 0,
  "pallets" INTEGER NOT NULL DEFAULT 0,
  "weight_kg" DECIMAL(12,2),
  "volume_cbm" DECIMAL(12,2),
  "handling" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_cargo_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_customs_files" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "declaration_no" TEXT,
  "regime" TEXT,
  "channel" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "responsible" TEXT,
  "submitted_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_customs_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_documents" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "owner" TEXT,
  "url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_incidents" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" "ImportadexSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "ImportadexIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "owner" TEXT,
  "description" TEXT,
  "due_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_events" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "owner" TEXT,
  "location" TEXT,
  "event_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_comments" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "author" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_attachments" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_url" TEXT NOT NULL,
  "file_type" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_audit_logs" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entity_id" TEXT,
  "actor" TEXT,
  "changes" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "importadex_clients" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "importadex_clients_pkey" PRIMARY KEY ("id"));
CREATE TABLE "importadex_providers" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "importadex_providers_pkey" PRIMARY KEY ("id"));
CREATE TABLE "importadex_carriers" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "mode" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "importadex_carriers_pkey" PRIMARY KEY ("id"));
CREATE TABLE "importadex_ports" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "country" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "importadex_ports_pkey" PRIMARY KEY ("id"));
CREATE TABLE "importadex_airports" ("id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "country" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "importadex_airports_pkey" PRIMARY KEY ("id"));
CREATE TABLE "importadex_warehouses" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "location" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "importadex_warehouses_pkey" PRIMARY KEY ("id"));
CREATE TABLE "importadex_terminals" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "location" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "importadex_terminals_pkey" PRIMARY KEY ("id"));
CREATE TABLE "importadex_catalogs" ("id" TEXT NOT NULL, "group" TEXT NOT NULL, "value" TEXT NOT NULL, "label" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "importadex_catalogs_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "importadex_clients_name_key" ON "importadex_clients"("name");
CREATE UNIQUE INDEX "importadex_providers_name_key" ON "importadex_providers"("name");
CREATE UNIQUE INDEX "importadex_carriers_name_key" ON "importadex_carriers"("name");
CREATE UNIQUE INDEX "importadex_airports_code_key" ON "importadex_airports"("code");
CREATE UNIQUE INDEX "importadex_catalogs_group_value_key" ON "importadex_catalogs"("group", "value");

ALTER TABLE "importadex_shipments" ADD CONSTRAINT "importadex_shipments_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_containers" ADD CONSTRAINT "importadex_containers_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_cargo_items" ADD CONSTRAINT "importadex_cargo_items_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_customs_files" ADD CONSTRAINT "importadex_customs_files_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_documents" ADD CONSTRAINT "importadex_documents_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_incidents" ADD CONSTRAINT "importadex_incidents_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_events" ADD CONSTRAINT "importadex_events_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_comments" ADD CONSTRAINT "importadex_comments_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_attachments" ADD CONSTRAINT "importadex_attachments_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "importadex_audit_logs" ADD CONSTRAINT "importadex_audit_logs_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
