// draft_revisions — Phase B.4 (HITL) — branch view backing.
// Per migrations/0006_draft_revisions.sql. Self-referential parent_revision_id
// forms the revision tree.

import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { agents } from "./agents";
import { companies } from "./companies";
import { drafts } from "./drafts";

export const reviewVerdictEnum = pgEnum("review_verdict", ["pass", "revise", "block"]);

export const draftRevisions = pgTable(
  "draft_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    parentRevisionId: uuid("parent_revision_id").references(
      (): AnyPgColumn => draftRevisions.id,
      { onDelete: "set null" },
    ),
    // 0 = initial; matches PublishState.revision_count at capture.
    revisionNumber: integer("revision_number").notNull(),
    body: text("body").notNull(),
    voiceScore: doublePrecision("voice_score"),
    voicePasses: boolean("voice_passes"),
    predictedPercentile: doublePrecision("predicted_percentile"),
    predictedPercentileLow: doublePrecision("predicted_percentile_low"),
    predictedPercentileHigh: doublePrecision("predicted_percentile_high"),
    criticNotes: text("critic_notes"),
    reviewVerdict: reviewVerdictEnum("review_verdict"),
    authoredByAgentId: uuid("authored_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    // Match against LangGraph PublishState.run_id so the trace ↔ DB join works.
    langgraphRunId: text("langgraph_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDraft: index("idx_draft_revisions_draft").on(t.draftId, t.revisionNumber),
    byCompanyRun: index("idx_draft_revisions_company_run").on(t.companyId, t.langgraphRunId),
  }),
);

export type DraftRevision = typeof draftRevisions.$inferSelect;
export type NewDraftRevision = typeof draftRevisions.$inferInsert;
