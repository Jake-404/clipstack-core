// drafts — every artifact the platform produces.

import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { agents } from "./agents";
import { channelEnum, draftStatusEnum } from "./enums";
import { companies } from "./companies";

export type DraftClaim = {
  statement: string;
  supportingUrl?: string;
  snippet?: string;
  retrievedAt?: string;
};

export const drafts = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
  parentDraftId: uuid("parent_draft_id").references(
    (): AnyPgColumn => drafts.id,
    { onDelete: "set null" },
  ),
  channel: channelEnum("channel").notNull(),
  status: draftStatusEnum("status").notNull().default("drafting"),
  title: text("title"),
  body: text("body").notNull(),
  hashtags: text("hashtags")
    .array()
    .notNull()
    .default(sql`ARRAY[]::TEXT[]`),
  claims: jsonb("claims")
    .notNull()
    .default(sql`'[]'::jsonb`)
    .$type<DraftClaim[]>(),
  voiceScore: doublePrecision("voice_score"),  // 0..1 enforced at DB CHECK
  predictedPercentile: doublePrecision("predicted_percentile"),  // 0..100 at DB
  authoredByAgentId: uuid("authored_by_agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  // approvalId left as plain UUID to avoid the cycle drafts ↔ approvals.
  // FK is enforced at DB but Drizzle relation declared at runtime.
  approvalId: uuid("approval_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedUrl: text("published_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
