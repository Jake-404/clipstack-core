// agents — per-company agent personas.

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { agentRoleEnum, agentStatusEnum } from "./enums";
import { companies } from "./companies";

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  role: agentRoleEnum("role").notNull(),
  displayName: text("display_name").notNull(),  // length 1..60 at DB
  jobDescription: text("job_description").notNull(),  // length 1..2000 at DB
  status: agentStatusEnum("status").notNull().default("idle"),
  modelProfile: text("model_profile").notNull().default("WRITER_MODEL"),
  toolsAllowed: text("tools_allowed")
    .array()
    .notNull()
    .default(sql`ARRAY[]::TEXT[]`),
  spawnedAt: timestamp("spawned_at", { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
