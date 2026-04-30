// permissions — role × resource × action × allow/deny.
// `clientId` null = applies to all clients.

import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { permissionActionEnum } from "./enums";
import { roles } from "./roles";

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  resource: text("resource").notNull(),
  action: permissionActionEnum("action").notNull(),
  allow: boolean("allow").notNull().default(true),
  clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
