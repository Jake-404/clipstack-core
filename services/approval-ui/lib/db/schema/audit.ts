// audit_log — append-only.
// `kind` is text (not enum) so new event kinds don't require DDL changes.

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { actorKindEnum } from "./enums";
import { companies } from "./companies";

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  actorKind: actorKindEnum("actor_kind").notNull(),
  actorId: text("actor_id"),
  detailsJson: jsonb("details_json")
    .notNull()
    .default(sql`'{}'::jsonb`)
    .$type<Record<string, unknown>>(),
  // weeks 9-10: zk Layer A Poseidon commitment hash
  commitmentHash: text("commitment_hash"),
  // Langfuse trace ID round-trip
  traceId: text("trace_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
