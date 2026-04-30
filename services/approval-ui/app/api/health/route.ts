// GET /api/health — liveness + version probe.
// No auth; no DB access. Used by docker-compose healthcheck + uptime probes.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";  // never cache health response
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      status: "ok",
      service: "approval-ui",
      version: "0.1.0",
      time: new Date().toISOString(),
    },
  });
}
