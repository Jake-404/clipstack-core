// /api/health/services — aggregated fleet health endpoint. Read-only and
// auth-free per the route's documented posture (status endpoints need to
// be reachable for monitoring). Returns the envelope shape produced by
// `ok(payload)` from lib/api/respond.ts → `{ ok: true, data: ... }`.
//
// The SERVICE_SPECS array in the route declares 8 backend services
// (agent-crewai, agent-langgraph, pii-detection, output-moderation,
// voice-scorer, performance-ingest, percentile-predictor, bandit-
// orchestrator). The response always includes one entry per service
// regardless of whether the BASE_URL is configured.

import { test, expect } from "@playwright/test";

interface ServiceHealthDetail {
  reachable: boolean;
  responseTimeMs: number | null;
  version: string | null;
  error: string | null;
}

interface ServiceHealthEntry {
  name: string;
  port: number;
  baseUrlConfigured: boolean;
  health: ServiceHealthDetail;
}

interface AggregatedHealth {
  overall: "healthy" | "degraded" | "down";
  timestamp: string;
  services: ServiceHealthEntry[];
}

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
}

test("health/services returns 200 with the expected envelope shape", async ({
  request,
}) => {
  const resp = await request.get("/api/health/services");
  expect(resp.status()).toBe(200);

  // The envelope: `{ ok: true, data: { overall, timestamp, services } }`.
  const body = (await resp.json()) as ApiEnvelope<AggregatedHealth>;
  expect(body.ok).toBe(true);
  expect(body.data).toBeDefined();

  const data = body.data;
  expect(data.overall).toMatch(/^(healthy|degraded|down)$/);
  expect(typeof data.timestamp).toBe("string");
  // Timestamp should parse as a valid ISO-8601 date.
  expect(Number.isFinite(Date.parse(data.timestamp))).toBe(true);

  // 8 services declared in SERVICE_SPECS — every aggregated response
  // returns one entry per service, even if BASE_URL is unset.
  expect(Array.isArray(data.services)).toBe(true);
  expect(data.services.length).toBeGreaterThanOrEqual(8);

  // Every entry has name + port + baseUrlConfigured + health subobject.
  for (const svc of data.services) {
    expect(typeof svc.name).toBe("string");
    expect(typeof svc.port).toBe("number");
    expect(typeof svc.baseUrlConfigured).toBe("boolean");
    expect(svc.health).toBeDefined();
    expect(typeof svc.health.reachable).toBe("boolean");
  }
});
