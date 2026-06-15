ALTER TABLE "importadex_clients"
ADD COLUMN IF NOT EXISTS "email_hash" TEXT,
ADD COLUMN IF NOT EXISTS "review_status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "importadex_clients_email_hash_key" ON "importadex_clients"("email_hash");
