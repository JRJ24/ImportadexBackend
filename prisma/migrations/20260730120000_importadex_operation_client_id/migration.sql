ALTER TABLE "importadex_operations" ADD COLUMN "client_id" TEXT;

UPDATE "importadex_operations" o
SET "client_id" = c.id
FROM "importadex_clients" c
WHERE o."client_id" IS NULL
  AND (
    o."client_name" = c.name
    OR o."client_name" = CONCAT(c.name, CASE WHEN c.last_name IS NULL OR BTRIM(c.last_name) = '' THEN '' ELSE CONCAT(' ', c.last_name) END)
  );

CREATE INDEX "importadex_operations_client_id_idx" ON "importadex_operations"("client_id");

ALTER TABLE "importadex_operations"
  ADD CONSTRAINT "importadex_operations_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "importadex_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
