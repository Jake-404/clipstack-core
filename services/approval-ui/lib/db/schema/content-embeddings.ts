// content_embeddings — vector representations of drafts for cosine-similarity
// retrieval (USP 1 closed-loop). bytea fallback in A.1; alters to vector(N)
// in a later A.2 migration once pgvector is verified across deployments.

import { customType, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { drafts } from "./drafts";

const bytea = customType<{ data: Uint8Array; default: false; notNull: false }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Uint8Array) {
    return Buffer.from(value);
  },
  fromDriver(value: unknown) {
    if (value instanceof Buffer) return new Uint8Array(value);
    if (value instanceof Uint8Array) return value;
    return new Uint8Array();
  },
});

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
    embedding: bytea("embedding").notNull(),
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
