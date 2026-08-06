ALTER TABLE "importadex_clients"
  ADD COLUMN IF NOT EXISTS "discovery_source" TEXT;

UPDATE "importadex_clients"
SET "discovery_source" = "feedBack"
WHERE "discovery_source" IS NULL
  AND "feedBack" IS NOT NULL
  AND BTRIM("feedBack") <> '';

CREATE INDEX IF NOT EXISTS "importadex_clients_discovery_source_idx"
  ON "importadex_clients"("discovery_source");

INSERT INTO "importadex_catalogs" (id, "group", value, label, active)
VALUES
  ('client-source-google', 'client_source', 'GOOGLE', 'Google', true),
  ('client-source-instagram', 'client_source', 'INSTAGRAM', 'Instagram', true),
  ('client-source-facebook', 'client_source', 'FACEBOOK', 'Facebook', true),
  ('client-source-tiktok', 'client_source', 'TIKTOK', 'TikTok', true),
  ('client-source-referido', 'client_source', 'REFERIDO', 'Referido', true),
  ('client-source-cliente-existente', 'client_source', 'CLIENTE_EXISTENTE', 'Cliente existente', true),
  ('client-source-web', 'client_source', 'WEB', 'Web', true),
  ('client-source-whatsapp', 'client_source', 'WHATSAPP', 'WhatsApp', true),
  ('client-source-evento', 'client_source', 'EVENTO', 'Evento', true),
  ('client-source-otro', 'client_source', 'OTRO', 'Otro', true)
ON CONFLICT ("group", value) DO UPDATE SET label = EXCLUDED.label, active = true;
