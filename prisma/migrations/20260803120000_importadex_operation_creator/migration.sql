ALTER TABLE "importadex_operations"
  ADD COLUMN "created_by_id" TEXT,
  ADD COLUMN "created_by_email" TEXT,
  ADD COLUMN "created_by_name" TEXT;

CREATE INDEX "importadex_operations_created_by_id_idx" ON "importadex_operations"("created_by_id");
