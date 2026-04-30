// companies — the tenant root.
// Self-referential `parentCompanyId` models the agency → client nesting.
// Per migrations/0001_init.sql.

import {
  boolean,  // unused now but kept for parity if columns flip later
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { companyTypeEnum, uiModeEnum } from "./enums";

void boolean;  // suppress unused-import without affecting bundle

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),  // SQL CHECK length 1..120 enforced at DB
  type: companyTypeEnum("type").notNull(),
  parentCompanyId: uuid("parent_company_id").references(
    (): AnyPgColumn => companies.id,
    { onDelete: "restrict" },
  ),
  uiMode: uiModeEnum("ui_mode").notNull().default("web2"),
  brandKitId: uuid("brand_kit_id"),
  activeRegimes: text("active_regimes")
    .array()
    .notNull()
    .default(sql`ARRAY[]::TEXT[]`),
  contextJson: jsonb("context_json")
    .notNull()
    .default(sql`'{}'::jsonb`)
    .$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
