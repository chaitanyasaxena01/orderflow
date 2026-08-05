-- Optional search helpers: trigram + full-text support for product name/description
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_description_trgm_idx
  ON products USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_search_fts_idx
  ON products USING gin (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
  );
