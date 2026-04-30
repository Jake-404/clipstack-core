// post_metrics — USP 1 closed-loop performance ingestion.
// Per migrations/0004_post_metrics.sql. One row per (draft, platform,
// snapshot_at). The percentile columns are workspace-relative; populated by
// a nightly rollup so retrieve_high_performers doesn't re-sort on read.

import {
  bigint,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { companies } from "./companies";
import { drafts } from "./drafts";

export const postMetrics = pgTable(
  "post_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    impressions: bigint("impressions", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    clicks: bigint("clicks", { mode: "number" }),
    reactions: bigint("reactions", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    saves: bigint("saves", { mode: "number" }),
    conversions: bigint("conversions", { mode: "number" }),
    // Ratios — DB CHECK enforces 0..1
    ctr: doublePrecision("ctr"),
    engagementRate: doublePrecision("engagement_rate"),
    conversionRate: doublePrecision("conversion_rate"),
    // Workspace-relative percentiles 0..100 — rolled up nightly
    ctrPercentile: doublePrecision("ctr_percentile"),
    engagementPercentile: doublePrecision("engagement_percentile"),
    conversionPercentile: doublePrecision("conversion_percentile"),
    raw: jsonb("raw").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    draftSnapshot: index("idx_post_metrics_draft").on(t.draftId, t.snapshotAt),
    companyPlatform: index("idx_post_metrics_company_platform").on(
      t.companyId,
      t.platform,
      t.snapshotAt,
    ),
    highEngagement: index("idx_post_metrics_high_engagement").on(
      t.companyId,
      t.engagementPercentile,
    ),
  }),
);

export type PostMetric = typeof postMetrics.$inferSelect;
export type NewPostMetric = typeof postMetrics.$inferInsert;
