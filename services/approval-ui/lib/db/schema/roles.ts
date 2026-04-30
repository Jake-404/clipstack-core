// roles — workspace-scoped role definitions.
// Defaults seeded per company by trigger in 0003_rbac_seed.sql.

import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./companies";

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),  // 'owner' | 'admin' | 'member' | 'client_guest' | custom
  displayName: text("display_name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
