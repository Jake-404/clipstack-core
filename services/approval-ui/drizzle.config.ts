// drizzle-kit config — generates migrations from lib/db/schema/* and pushes
// against DATABASE_URL. The hand-written SQL migrations under
// services/shared/db/migrations/ are still the canonical source of the schema
// (RLS policies + triggers + functions live there); drizzle-kit's output is
// ergonomic for review-style diffs but is not the production-applied artifact
// in A.2. A.3 reconciles to a single migration runner.

import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Strict — fail noisily if DB and schema disagree.
  strict: true,
  verbose: true,
} satisfies Config;
