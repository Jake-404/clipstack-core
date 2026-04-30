// memberships — user × company × role.
// At most one active membership per (user_id, company_id, client_id) where
// revoked_at IS NULL — enforced by partial unique index in 0001_init.sql.

import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { users } from "./users";

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
  // FK target on roles below (forward reference via uuid only — Drizzle
  // doesn't enforce relational FK in the type system, but the DB does).
  roleId: uuid("role_id").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
