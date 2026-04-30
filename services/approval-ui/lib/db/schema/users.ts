// users — global identity (workspace-independent).
// `workosUserId` populated by the WorkOS SSO callback; null until linked.
// Per migrations/0001_init.sql.

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { uiModeEnum } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  uiMode: uiModeEnum("ui_mode").notNull().default("web2"),
  workosUserId: text("workos_user_id").unique(),
  mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
