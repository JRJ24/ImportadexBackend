CREATE TABLE "importadex_email_logs" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "audience" TEXT,
  "subject" TEXT,
  "recipient_masked" TEXT,
  "recipient_domain" TEXT,
  "operation_id" TEXT,
  "client_id" TEXT,
  "smtp_host" TEXT,
  "smtp_user" TEXT,
  "message_id" TEXT,
  "smtp_response" TEXT,
  "accepted" INTEGER NOT NULL DEFAULT 0,
  "rejected" INTEGER NOT NULL DEFAULT 0,
  "skipped" BOOLEAN NOT NULL DEFAULT false,
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "importadex_email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "importadex_email_logs_created_at_idx" ON "importadex_email_logs"("created_at");
CREATE INDEX "importadex_email_logs_audience_idx" ON "importadex_email_logs"("audience");
CREATE INDEX "importadex_email_logs_status_idx" ON "importadex_email_logs"("status");
CREATE INDEX "importadex_email_logs_operation_id_idx" ON "importadex_email_logs"("operation_id");
CREATE INDEX "importadex_email_logs_client_id_idx" ON "importadex_email_logs"("client_id");

ALTER TABLE "importadex_email_logs"
  ADD CONSTRAINT "importadex_email_logs_operation_id_fkey"
  FOREIGN KEY ("operation_id") REFERENCES "importadex_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "importadex_email_logs"
  ADD CONSTRAINT "importadex_email_logs_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "importadex_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
