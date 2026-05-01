// company_lessons — USP 5 editorial memory.
// `embedding` is `vector(384)` since 0007_alter_embedding_to_vector.sql.
// recall_lessons + USP 1 cosine-similarity surfaces query against the
// ivfflat index built in that migration.

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { agents } from "./agents";
import { companies } from "./companies";
import { lessonKindEnum, lessonScopeEnum } from "./enums";
import { users } from "./users";
import { vector384 } from "./_vector";

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
  embedding: vector384("embedding"),
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
