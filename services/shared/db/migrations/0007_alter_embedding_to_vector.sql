-- 0007_alter_embedding_to_vector.sql — promote embedding columns from
-- BYTEA fallback to native pgvector vectors.
--
-- 0001 + 0004 stored embeddings as BYTEA with a graceful "pgvector may not
-- be present" fallback (see DO block at the top of 0001). That fallback
-- was scaffolding — recall_lessons + USP 1 cosine similarity need real
-- vector ops, not opaque bytes. This migration makes pgvector a hard
-- requirement and converts both embedding columns to vector(384).
--
-- 384 dimensions matches the default model in infra/litellm/config.yaml
-- (Ollama nomic-embed-text via the VOICE_EMBED_MODEL profile, dim=384,
-- and MiniLM-L6-v2 which a follow-up Phase C may use).
--
-- Apply after 0006_draft_revisions.sql.
--
-- Data preservation: this migration DROPs existing embedding data. There's
-- no production data yet (Phase B); A.1's BYTEA scaffolding only ever
-- carried the column shape. If you're applying against a deployment with
-- real BYTEA-encoded vectors, decode + re-insert via a separate one-shot
-- script before running 0007 — don't pretend the alter preserves them.

-- ─── Hard requirement: pgvector ──────────────────────────────────────────
-- The 0001 migration's DO block tolerated a missing vector extension; 0007
-- requires it. Idempotent IF NOT EXISTS — fails loudly only if the
-- extension genuinely can't be created (host doesn't ship it).
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── company_lessons.embedding: BYTEA → vector(384) ──────────────────────
ALTER TABLE company_lessons
  DROP COLUMN IF EXISTS embedding;
ALTER TABLE company_lessons
  ADD COLUMN embedding vector(384);

-- ivfflat index for cosine recall. Lists=100 is a solid default for
-- workspaces with up to ~100k lessons; tune later when call sites profile.
-- The index is built only when there's data; it's harmless on empty tables.
CREATE INDEX IF NOT EXISTS idx_company_lessons_embedding_cosine
  ON company_lessons USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ─── content_embeddings.embedding: BYTEA NOT NULL → vector(384) NOT NULL ─
ALTER TABLE content_embeddings
  DROP COLUMN IF EXISTS embedding;
ALTER TABLE content_embeddings
  ADD COLUMN embedding vector(384) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_embeddings_embedding_cosine
  ON content_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- The embedding_dim column on content_embeddings becomes redundant with
-- the typed vector(384) column but stays for forward compatibility — when
-- A future migration introduces multi-dimension support (e.g., 1536-d for
-- text-embedding-3-small), embedding_dim disambiguates per-row. For now
-- it's locked to 384 by the column type.
ALTER TABLE content_embeddings
  ALTER COLUMN embedding_dim SET DEFAULT 384;
