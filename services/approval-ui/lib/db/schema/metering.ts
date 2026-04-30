// meter_events — USP 10 metering counter.
// One row per published artifact; written in the same transaction as publish.

import { doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { meterEventKindEnum } from "./enums";

export const meterEvents = pgTable("meter_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
  kind: meterEventKindEnum("kind").notNull(),
  quantity: doublePrecision("quantity").notNull(),  // ≥0 enforced at DB CHECK
  unitCostUsd: doublePrecision("unit_cost_usd"),
  totalCostUsd: doublePrecision("total_cost_usd"),
  refKind: text("ref_kind"),
  refId: text("ref_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MeterEvent = typeof meterEvents.$inferSelect;
export type NewMeterEvent = typeof meterEvents.$inferInsert;
