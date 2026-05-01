// Embeddings helper. Calls LiteLLM's OpenAI-compatible /embeddings
// endpoint using the `VOICE_EMBED_MODEL` named profile (resolves to
// `ollama/all-minilm` in the default infra config — 384-dim, PII-safe,
// local-only).
//
// The dim is the load-bearing invariant: the SQL columns are vector(384),
// the Drizzle vector384 customType refuses other lengths, and this helper
// asserts the response dim matches before returning. A model swap that
// changes dim breaks loudly here, not silently downstream.
//
// Fail-soft: on LiteLLM outage / non-200, throws an ApiError that the
// route boundary surfaces as 503. Calling routes treat that as "embedding
// unavailable, fall back to non-vector ranking" rather than 500.

import { ApiError } from "./errors";

const LITELLM_BASE_URL =
  process.env.LITELLM_BASE_URL ?? "http://litellm:4000";
const LITELLM_MASTER_KEY =
  process.env.LITELLM_MASTER_KEY ?? "sk-clipstack-dev";
const VOICE_EMBED_MODEL =
  process.env.VOICE_EMBED_MODEL ?? "voice-embed";
const EMBED_DIM = 384;
const EMBED_TIMEOUT_MS = 8_000;

/**
 * Embed a string into a 384-dim vector via LiteLLM. Returns the raw
 * `number[]` so the caller can pass it directly into a Drizzle
 * `vector384(...)` column or a parameterised cosine query.
 *
 * Throws ApiError on:
 *   - empty / oversized input  → 400 bad_request
 *   - LiteLLM unreachable      → 503 unavailable
 *   - LiteLLM non-200          → 503 unavailable (with status detail)
 *   - response dim mismatch    → 500 internal (config drift)
 */
export async function embed(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ApiError("bad_request", "embed input is empty");
  }
  if (trimmed.length > 8000) {
    throw new ApiError(
      "bad_request",
      "embed input too long; trim to <8000 chars before calling",
    );
  }

  let resp: Response;
  try {
    resp = await fetch(`${LITELLM_BASE_URL.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${LITELLM_MASTER_KEY}`,
      },
      body: JSON.stringify({
        model: VOICE_EMBED_MODEL,
        input: trimmed,
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    throw new ApiError(
      "internal",
      "LiteLLM unreachable for embeddings",
      { cause: e instanceof Error ? e.message : String(e) },
    );
  }

  if (!resp.ok) {
    let body = "";
    try {
      body = (await resp.text()).slice(0, 240);
    } catch {
      /* ignore */
    }
    throw new ApiError(
      "internal",
      `LiteLLM embeddings returned ${resp.status}`,
      { status: resp.status, body },
    );
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch (e: unknown) {
    throw new ApiError(
      "internal",
      "LiteLLM embeddings returned non-JSON",
      { cause: e instanceof Error ? e.message : String(e) },
    );
  }

  // OpenAI-compatible response shape:
  //   { data: [{ embedding: [...numbers] }, ...] }
  const arr = (data as { data?: { embedding?: number[] }[] })?.data;
  const vec = Array.isArray(arr) ? arr[0]?.embedding : undefined;
  if (!Array.isArray(vec)) {
    throw new ApiError(
      "internal",
      "LiteLLM embeddings response missing data[0].embedding",
    );
  }
  if (vec.length !== EMBED_DIM) {
    throw new ApiError(
      "internal",
      `embedding dim mismatch: model returned ${vec.length}, expected ${EMBED_DIM}. ` +
        "Update infra/litellm/config.yaml voice-embed profile to a 384-dim model " +
        "OR migrate the column type.",
    );
  }

  return vec;
}

/** Format a number[] for pgvector's literal text input. Used when binding
 *  via the drizzle sql template tag — pgvector accepts '[1,2,3,...]'. */
export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
