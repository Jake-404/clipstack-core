// UUID validation — single source of truth.
// Used by route handlers to gate dynamic path params + by auth helpers
// to validate header-supplied workspace ids before tenant binding.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true if `s` is a canonical UUID (any version, hex case-insensitive). */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** Convenience for use inside zod superRefine() and similar. */
export const UUID_PATTERN = UUID_RE;
