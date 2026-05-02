# OpenAPI spec — `core/docs/openapi.yaml`

A hand-written OpenAPI 3.1 spec for the approval-ui HTTP surface. It's the
machine-readable counterpart to `core/docs/api.md` (the prose reference).

## What it covers

Every Next.js App Router handler under `services/approval-ui/app/api/` that
isn't part of the WorkOS auth flow:

- **Approvals** — `POST /api/approvals/{id}/approve`, `POST /api/approvals/{id}/deny`
- **Drafts** — high-performers list, revisions list, claim verifier
- **Lessons** — cosine-similarity recall against `company_lessons`
- **Metering** — meter-events writer + post-metrics batch writer
- **Experiments** — read-through proxy onto `bandit-orchestrator`
- **Anomalies** — read-through proxy onto `performance-ingest`
- **Audit** — generic audit-log ingest
- **Health** — `GET /api/health`, `GET /api/health/services`

The WorkOS auth-flow routes (`/api/auth/login`, `/api/auth/callback`,
`/api/auth/logout`) are intentionally omitted — their redirect + cookie-set
shape doesn't fit cleanly into OpenAPI response schemas. See
`core/docs/auth.md` for the narrative reference.

The spec covers the backend FastAPI services (`bandit-orchestrator`,
`performance-ingest`, etc.) only as upstream targets reflected in the
proxy responses; their direct routes are out of scope for this file.

## How to view it

Redocly's preview is the cleanest local renderer:

```sh
pnpm dlx @redocly/cli preview-docs core/docs/openapi.yaml
```

Alternatively, paste the YAML into:

- [Swagger UI](https://editor.swagger.io/) — quick sanity-check
- [Redocly Reference](https://redocly.com/redocly-cli/) — read-the-docs aesthetic
- VS Code's *OpenAPI (Swagger) Editor* extension for inline lint as you edit

## How to generate clients

The spec is OpenAPI 3.1 so any compliant generator works. The team default is
[`@openapitools/openapi-generator-cli`](https://github.com/OpenAPITools/openapi-generator):

```sh
# TypeScript (fetch-based)
npx @openapitools/openapi-generator-cli generate \
  -i core/docs/openapi.yaml \
  -g typescript-fetch \
  -o ./generated/clipstack-ts

# Python (httpx-based)
npx @openapitools/openapi-generator-cli generate \
  -i core/docs/openapi.yaml \
  -g python \
  -o ./generated/clipstack-py

# Go
npx @openapitools/openapi-generator-cli generate \
  -i core/docs/openapi.yaml \
  -g go \
  -o ./generated/clipstack-go
```

Other useful targets:

- `typescript-axios`, `typescript-node` — alt TS HTTP clients
- `rust` — for Rust integrators
- `markdown` — regenerates a prose reference from the spec

## Drift caveat

**This spec is hand-written.** The source of truth is the route files at
`services/approval-ui/app/api/**/route.ts` and the zod schemas they parse.
This file may drift from the code between releases. A drift checker
(generate-from-zod plus a CI gate that diffs against `openapi.yaml`) is on
the roadmap — until then, treat the YAML as a snapshot.

## Cadence

Regenerate (manually) when:

- A route's path, method, or zod schema changes
- A new route lands under `services/approval-ui/app/api/`
- An enum in `lib/db/schema/enums.ts` gains or drops a value that's exposed
  on the wire
- A sibling-service shape (`AnomalyDetection`, `BanditSummary`) shifts and the
  proxy passes the new field through

After editing:

1. Read the diff against the route handlers — every `$ref` must resolve to a
   schema you actually defined.
2. Lint with `pnpm dlx @redocly/cli lint core/docs/openapi.yaml`.
3. Confirm `openapi: "3.1.0"` is preserved.

## File layout

```
core/docs/
  openapi.yaml          # the spec (this file's subject)
  openapi-README.md     # you are here
  api.md                # prose reference
  auth.md               # WorkOS flow + dev auto-provision
  closed-loop.md        # generate→publish→measure→learn pipeline
  observability.md      # Langfuse trace conventions
  dr/                   # disaster recovery runbooks
```
