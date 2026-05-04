// GET /api/health/services
// Aggregated service-health status surface — probes every backend
// FastAPI service the platform depends on and returns one envelope.
//
// Why a separate endpoint from /api/health: that route reports the
// approval-ui's own liveness (used by docker-compose's healthcheck +
// uptime probes); this route reports the *fleet*. Useful for status
// pages, monitoring tools, and Mission Control polling that wants a
// single fetch instead of nine.
//
// Why a superset of fetchBusHealth (in app/page.tsx): the BusHealthTile
// is a focused 3-probe widget for the redpanda-driven event bus. This
// route is broader — every service we run gets a row, plus the same
// producer / consumer stats where they exist. The bus tile stays as-is.
//
// Auth posture: NONE. Status endpoints need to be reachable for
// monitoring without a session, and nothing here leaks tenant data —
// every probe targets process-local /health and the /producer/status
// + /consumer/status routes return pure operational counters. Cache-
// Control: no-store so monitors always see fresh data.
//
// Fail-soft semantics: if a service's BASE_URL env is unset we mark it
// `baseUrlConfigured: false` rather than fetch and 502 — the right
// answer in dev where most backends aren't wired. `overall` distinguishes
// "no backends configured at all" (healthy, not claiming to know) from
// "configured but down" (down/degraded).

import { ok, withApi } from "@/lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Health probes should fail fast — a wedged service shouldn't drag
// the whole status response with it. The proxy routes use 5s; status
// runs at 2s because every service in the fleet is probed in parallel
// and the slowest still bounds the response time.
const PROBE_TIMEOUT_MS = 2000;

interface ServiceProducerStats {
  enabled: boolean;
  emitCount: number;
  emitErrors: number;
}

interface ServiceConsumerStats {
  enabled: boolean;
  consumedCount: number;
  matchedCount: number;
  handleErrors: number;
}

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
  producer?: ServiceProducerStats | null;
  consumer?: ServiceConsumerStats | null;
}

type OverallStatus = "healthy" | "degraded" | "down";

interface AggregatedHealth {
  overall: OverallStatus;
  timestamp: string;
  services: ServiceHealthEntry[];
}

// Static catalogue of every backend service in the platform. Each row
// is the source of truth for: env var name, port (informational, used
// by status pages), and whether to probe /producer/status or
// /consumer/status alongside /health.
//
// Adding a new service: append one row + (optionally) wire its probe.
interface ServiceSpec {
  name: string;
  port: number;
  envVar: string;
  busProbe: "producer" | "consumer" | null;
}

const SERVICE_SPECS: readonly ServiceSpec[] = [
  { name: "agent-crewai", port: 8001, envVar: "AGENT_CREWAI_BASE_URL", busProbe: null },
  { name: "agent-langgraph", port: 8002, envVar: "AGENT_LANGGRAPH_BASE_URL", busProbe: "producer" },
  { name: "pii-detection", port: 8003, envVar: "PII_DETECTION_BASE_URL", busProbe: null },
  { name: "output-moderation", port: 8004, envVar: "OUTPUT_MODERATION_BASE_URL", busProbe: null },
  { name: "voice-scorer", port: 8005, envVar: "VOICE_SCORER_BASE_URL", busProbe: null },
  { name: "performance-ingest", port: 8006, envVar: "PERFORMANCE_INGEST_BASE_URL", busProbe: "producer" },
  { name: "percentile-predictor", port: 8007, envVar: "PERCENTILE_PREDICTOR_BASE_URL", busProbe: null },
  { name: "bandit-orchestrator", port: 8008, envVar: "BANDIT_ORCH_BASE_URL", busProbe: "consumer" },
] as const;

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asBool(v: unknown): boolean {
  return typeof v === "boolean" ? v : false;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    // AbortSignal.timeout fires DOMException("TimeoutError"); surface
    // that explicitly so a status page can distinguish "down" from
    // "slow" without parsing message strings on the client.
    if (err.name === "TimeoutError") return "timeout";
    return err.message || err.name || "unknown error";
  }
  return "unknown error";
}

async function probeHealth(baseUrl: string): Promise<ServiceHealthDetail> {
  const startedAt = Date.now();
  try {
    const resp = await fetch(`${trimSlash(baseUrl)}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const responseTimeMs = Date.now() - startedAt;
    if (!resp.ok) {
      return {
        reachable: false,
        responseTimeMs,
        version: null,
        error: `HTTP ${resp.status}`,
      };
    }
    // A 200 with non-JSON body (HTML 502 from a misbehaving proxy, gzip-
    // decoded badness, etc.) lands in this catch via JSON.parse — which
    // is why this await sits inside the try block, not above the if.
    const payload = (await resp.json()) as Record<string, unknown>;
    return {
      reachable: true,
      responseTimeMs,
      version: asStringOrNull(payload.version),
      error: null,
    };
  } catch (err) {
    // Failure paths (timeout, DNS, JSON parse, refused connection) all
    // surface responseTimeMs=null so consumers can rely on `truthy =
    // probe completed and parsed`. The wall-clock time of a failed probe
    // isn't operationally useful and would confuse charts that plot
    // responseTimeMs as a latency series.
    return {
      reachable: false,
      responseTimeMs: null,
      version: null,
      error: describeError(err),
    };
  }
}

async function probeProducerStatus(baseUrl: string): Promise<ServiceProducerStats | null> {
  try {
    const resp = await fetch(`${trimSlash(baseUrl)}/producer/status`, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const payload = (await resp.json()) as Record<string, unknown>;
    return {
      enabled: asBool(payload.enabled),
      emitCount: asNumber(payload.emit_count),
      emitErrors: asNumber(payload.emit_errors),
    };
  } catch (err) {
    // Probe failures are operationally interesting — log so the health
    // route's "the producer probe failed" outcome is debuggable without
    // having to add a logger from scratch on the next regression.
    console.error("[health/services] probeProducerStatus failed", { baseUrl, err });
    return null;
  }
}

async function probeConsumerStatus(baseUrl: string): Promise<ServiceConsumerStats | null> {
  try {
    const resp = await fetch(`${trimSlash(baseUrl)}/consumer/status`, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const payload = (await resp.json()) as Record<string, unknown>;
    return {
      enabled: asBool(payload.enabled),
      consumedCount: asNumber(payload.consumed_count),
      matchedCount: asNumber(payload.matched_count),
      handleErrors: asNumber(payload.handle_errors),
    };
  } catch (err) {
    console.error("[health/services] probeConsumerStatus failed", { baseUrl, err });
    return null;
  }
}

async function probeService(spec: ServiceSpec): Promise<ServiceHealthEntry> {
  const baseUrl = process.env[spec.envVar];

  // Unset env var = "not configured for this environment". The right
  // answer is to surface that explicitly rather than masquerade it as
  // a real outage — dev would otherwise paint half the fleet red.
  if (!baseUrl) {
    const entry: ServiceHealthEntry = {
      name: spec.name,
      port: spec.port,
      baseUrlConfigured: false,
      health: {
        reachable: false,
        responseTimeMs: null,
        version: null,
        error: "not configured",
      },
    };
    if (spec.busProbe === "producer") entry.producer = null;
    if (spec.busProbe === "consumer") entry.consumer = null;
    return entry;
  }

  // Health + bus probe in parallel — they touch independent routes,
  // both sub-2s, no reason to serialize.
  const [health, producer, consumer] = await Promise.all([
    probeHealth(baseUrl),
    spec.busProbe === "producer" ? probeProducerStatus(baseUrl) : Promise.resolve(null),
    spec.busProbe === "consumer" ? probeConsumerStatus(baseUrl) : Promise.resolve(null),
  ]);

  const entry: ServiceHealthEntry = {
    name: spec.name,
    port: spec.port,
    baseUrlConfigured: true,
    health,
  };
  if (spec.busProbe === "producer") entry.producer = producer;
  if (spec.busProbe === "consumer") entry.consumer = consumer;
  return entry;
}

function computeOverall(services: readonly ServiceHealthEntry[]): OverallStatus {
  const configured = services.filter((s) => s.baseUrlConfigured);

  // No backends wired (typical local dev) — the API isn't claiming to
  // know about real services, so reporting "down" would be misleading
  // noise on every monitor that polls a dev box.
  if (configured.length === 0) return "healthy";

  const unreachable = configured.filter((s) => !s.health.reachable);
  if (unreachable.length === 0) return "healthy";
  if (unreachable.length === configured.length) return "down";
  return "degraded";
}

export const GET = withApi(async () => {
  // All eight probes fan out at once. Total latency is bounded by the
  // slowest probe (≤ PROBE_TIMEOUT_MS) — not the sum of probe times —
  // which is the whole point of this aggregator route.
  const services = await Promise.all(SERVICE_SPECS.map(probeService));

  const payload: AggregatedHealth = {
    overall: computeOverall(services),
    timestamp: new Date().toISOString(),
    services,
  };

  // no-store so external monitors never get a cached snapshot. The
  // upstream services already render this in milliseconds; caching
  // would be a footgun for the one consumer (a status page) that
  // most needs fresh truth.
  const response = ok(payload);
  response.headers.set("Cache-Control", "no-store");
  return response;
});
