// AnalyticsAdapter — read-only access to per-workspace analytics events.
// Per Doc 6 §14 + Doc 4 §2.2 (post_metrics ingestion).

export interface AnalyticsEvent {
  eventName: string;
  url?: string;
  occurredAt: string;       // ISO-8601
  visitorId?: string;
  sessionId?: string;
  properties?: Record<string, string | number | boolean | null>;
}

export interface MetricSeries {
  metric: string;           // e.g. "pageviews" | "ctr" | "conversion_rate"
  unit?: string;
  points: Array<{ at: string; value: number }>;
}

export interface AnalyticsQuery {
  metric: string;
  startAt: string;          // ISO-8601 inclusive
  endAt: string;            // ISO-8601 exclusive
  groupBy?: "day" | "hour" | "week" | "url" | "referrer" | "campaign";
  filters?: Record<string, string | string[]>;
  limit?: number;
}

export interface AnalyticsAdapter {
  readonly vendor: string;
  readonly workspaceId: string;

  /** Pull a single metric across the time window. */
  getMetric(query: AnalyticsQuery): Promise<MetricSeries>;

  /** Stream raw events (for the post_metrics ingestor). */
  listEvents(opts: { since: string; until?: string; cursor?: string; limit?: number }):
    Promise<{ events: AnalyticsEvent[]; nextCursor?: string }>;

  /** Verify connection / quota. */
  healthCheck(): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
