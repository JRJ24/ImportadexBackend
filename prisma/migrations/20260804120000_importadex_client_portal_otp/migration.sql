CREATE TABLE "importadex_client_portal_otps" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importadex_client_portal_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "importadex_client_portal_otps_client_created_idx"
  ON "importadex_client_portal_otps"("client_id", "created_at");

CREATE INDEX "importadex_client_portal_otps_expires_idx"
  ON "importadex_client_portal_otps"("expires_at");

ALTER TABLE "importadex_client_portal_otps"
  ADD CONSTRAINT "importadex_client_portal_otps_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "importadex_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
