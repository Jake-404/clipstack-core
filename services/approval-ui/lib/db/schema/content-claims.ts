// content_claims — USP 8 provenance.
// Normalises the JSONB claim array on `drafts.claims` into queryable rows
// the verifier can re-check on cadence. Per migrations/0005_content_claims.sql.

import {
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { agents } from "./agents";
import { companies } from "./companies";
import { drafts } from "./drafts";

export const claimVerifierStatusEnum = pgEnum("claim_verifier_status", [
  "pending",
  "verified",
  "drift",
  "dead_link",
  "unsupported",
  "paywalled",
  "rate_limited",
]);

export const contentClaims = pgTable(
  "content_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => companies.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    // CHECK length 1..4000 enforced at DB
    statement: text("statement").notNull(),
    supportingUrl: text("supporting_url"),
    snippet: text("snippet"),
    snippetHash: text("snippet_hash"),
    verifierStatus: claimVerifierStatusEnum("verifier_status").notNull().default("pending"),
    verifierScore: doublePrecision("verifier_score"),
    verifierLastRunAt: timestamp("verifier_last_run_at", { withTimezone: true }),
    verifierDetailsJson: jsonb("verifier_details_json")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
    authoredByAgentId: uuid("authored_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDraft: index("idx_content_claims_draft").on(t.draftId),
    byCompanyStatus: index("idx_content_claims_company_status").on(
      t.companyId,
      t.verifierStatus,
      t.verifierLastRunAt,
    ),
  }),
);

export type ContentClaim = typeof contentClaims.$inferSelect;
export type NewContentClaim = typeof contentClaims.$inferInsert;
