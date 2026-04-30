// approvals — the human-action queue. USP 5 fields: deny_rationale + deny_scope.

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { agents } from "./agents";
import { approvalKindEnum, approvalStatusEnum, denyScopeEnum } from "./enums";
import { companies } from "./companies";
import { users } from "./users";

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
  kind: approvalKindEnum("kind").notNull(),
  status: approvalStatusEnum("status").notNull().default("pending"),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  // USP 5 — CHECK length BETWEEN 20 AND 2000 at DB; zod re-enforces at HTTP boundary.
  denyRationale: text("deny_rationale"),
  denyScope: denyScopeEnum("deny_scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
