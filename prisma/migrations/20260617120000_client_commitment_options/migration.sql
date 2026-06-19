ALTER TABLE importadex_clients
  ADD COLUMN commitment_document_url TEXT,
  ADD COLUMN commitment_document_name TEXT;

CREATE INDEX IF NOT EXISTS importadex_catalogs_group_label_idx
  ON importadex_catalogs ("group", label);
