// company_lessons — USP 5 editorial memory.
// `embedding` is bytea in A.1 (pgvector fallback path); A.2 alters to
// `vector(384)` once we verify pgvector is installed in the deployment.
// Until then, callers store the raw f32 array as bytes; recall_lessons
// HTTP service decodes when reading.

import { customType, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { agents } from "./agents";
import { companies } from "./companies";
import { lessonKindEnum, lessonScopeEnum } from "./enums";
import { users } from "./users";

// Drizzle ships bytea in pg-core but the type isn't named — define a custom
// type to match the SQL column.
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

export const companyLessons = pgTable("company_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
  kind: lessonKindEnum("kind").notNull(),
  scope: lessonScopeEnum("scope").notNull(),
  // CHECK length BETWEEN 20 AND 2000 enforced at DB. zod adds the same
  // constraint at the HTTP boundary.
  rationale: text("rationale").notNull(),
  topicTags: text("topic_tags")
    .array()
    .notNull()
    .default(sql`ARRAY[]::TEXT[]`),
  embedding: bytea("embedding"),
  capturedByUserId: uuid("captured_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  capturedByAgentId: uuid("captured_by_agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompanyLesson = typeof companyLessons.$inferSelect;
export type NewCompanyLesson = typeof companyLessons.$inferInsert;
