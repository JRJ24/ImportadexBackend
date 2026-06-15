ALTER TABLE "importadex_attachments"
ADD COLUMN IF NOT EXISTS "document_id" TEXT;

CREATE INDEX IF NOT EXISTS "importadex_attachments_document_id_idx" ON "importadex_attachments"("document_id");

ALTER TABLE "importadex_attachments"
ADD CONSTRAINT "importadex_attachments_document_id_fkey"
FOREIGN KEY ("document_id") REFERENCES "importadex_documents"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
