// content_embeddings — vector representations of drafts for cosine-similarity
// retrieval (USP 1 closed-loop). `embedding` is `vector(384)` since
// 0007_alter_embedding_to_vector.sql; the ivfflat index built in that
// migration powers retrieve_high_performers' similarity ranking.

import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { drafts } from "./drafts";
import { vector384 } from "./_vector";

export const contentEmbeddings = pgTable(
  "content_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    // sha256 of the text that was embedded — lets re-embed skip identical text
    textHash: text("text_hash").notNull(),
    embedding: vector384("embedding").notNull(),
    // Defaults to 384 (per migration 0007). When a future migration introduces
    // multi-dimension support (e.g., 1536 for text-embedding-3-small), this
    // disambiguates per-row; for now it's locked to 384 by the column type.
    embeddingDim: integer("embedding_dim").notNull().default(384),
    modelVersion: text("model_version").notNull().default("minilm-l6-v2-2024-09"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    draftHash: uniqueIndex("idx_content_embeddings_draft_hash").on(t.draftId, t.textHash),
  }),
);

export type ContentEmbedding = typeof contentEmbeddings.$inferSelect;
export type NewContentEmbedding = typeof contentEmbeddings.$inferInsert;
