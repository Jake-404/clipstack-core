// pgvector custom type for Drizzle.
//
// Replaces the BYTEA fallback used in A.1 + the early A.3 schemas. After
// 0007_alter_embedding_to_vector.sql lands, every embedding column is
// vector(N) where N defaults to 384 (matching nomic-embed-text + MiniLM-L6-v2).
//
// pgvector accepts a literal `'[1,2,3,...]'` string on insert; postgres-js
// returns the same string on read. We marshal both directions here so call
// sites work with plain `number[]`.

import { customType } from "drizzle-orm/pg-core";

/** Strict 384-d vector — matches the model dim Phase B locked. */
export const vector384 = customType<{
  data: number[];
  driverData: string;
  default: false;
  notNull: false;
}>({
  dataType() {
    return "vector(384)";
  },
  toDriver(value: number[]): string {
    if (!Array.isArray(value)) {
      throw new TypeError("vector(384) expects number[]");
    }
    if (value.length !== 384) {
      throw new RangeError(
        `vector(384) length must be 384; got ${value.length}`,
      );
    }
    // pgvector text representation: '[1.0,2.0,...]'
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    if (Array.isArray(value)) return value as number[];
    if (typeof value === "string") {
      // postgres-js returns the canonical string form '[1,2,3]'; safe to
      // JSON.parse — pgvector outputs are all numeric and bracket-wrapped.
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed as number[];
      } catch {
        /* fall through */
      }
    }
    return [];
  },
});
