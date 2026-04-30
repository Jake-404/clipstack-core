// Typed API error responses. Routes throw these and the route boundary
// converts them to the appropriate HTTP status + JSON shape.

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_failed"
  | "rate_limited"
  | "internal";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function badRequest(message: string, details?: unknown): never {
  throw new ApiError("bad_request", message, details);
}
export function unauthorized(message = "auth required"): never {
  throw new ApiError("unauthorized", message);
}
export function forbidden(message = "not allowed"): never {
  throw new ApiError("forbidden", message);
}
export function notFound(message = "not found"): never {
  throw new ApiError("not_found", message);
}
export function validationFailed(message: string, details?: unknown): never {
  throw new ApiError("validation_failed", message, details);
}
export function conflict(message: string, details?: unknown): never {
  throw new ApiError("conflict", message, details);
}
