// Route boundary helpers — uniform JSON envelope, consistent error shape.

import { NextResponse } from "next/server";

import { ApiError } from "./errors";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T, init: ResponseInit = {}): NextResponse<ApiSuccess<T>> {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, init);
}

export function fail(err: unknown): NextResponse<ApiFailure> {
  if (err instanceof ApiError) {
    return NextResponse.json<ApiFailure>(
      { ok: false, error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  // Unknown errors get sanitised — never leak internal stack traces / paths.
  // Operational errors should always extend ApiError; reaching this branch is
  // a programmer bug worth logging.
  console.error("[api] unhandled error:", err);
  return NextResponse.json<ApiFailure>(
    { ok: false, error: { code: "internal", message: "internal error" } },
    { status: 500 },
  );
}

/**
 * Wrap a route handler so any thrown ApiError lands as a typed envelope and
 * unhandled errors fall through to a sanitised 500. Use as:
 *
 *   export const POST = withApi(async (req, ctx) => {
 *     ... business logic ...
 *     return ok({ approval: ... });
 *   });
 */
export function withApi<Args extends unknown[], R>(
  handler: (...args: Args) => Promise<NextResponse<R>>,
) {
  return async (...args: Args): Promise<NextResponse<R | ApiFailure>> => {
    try {
      return await handler(...args);
    } catch (err) {
      return fail(err);
    }
  };
}
