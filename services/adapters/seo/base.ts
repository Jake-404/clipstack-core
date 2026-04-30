// SEOAdapter — keyword research + site / page audits.
// Per Doc 6 §14. Wraps Ahrefs / DataForSEO / Screaming Frog.

export interface KeywordMetrics {
  keyword: string;
  searchVolume?: number;
  difficulty?: number;        // 0..100
  cpcUsd?: number;
  intent?: "informational" | "navigational" | "commercial" | "transactional";
  trend?: number[];           // 12-month relative
}

export interface BacklinkRow {
  sourceUrl: string;
  targetUrl: string;
  anchorText?: string;
  domainRating?: number;
  firstSeenAt?: string;
}

export interface SiteAuditIssue {
  url: string;
  severity: "critical" | "warning" | "notice";
  category: "performance" | "indexability" | "content" | "schema" | "links";
  title: string;
  description?: string;
}

export interface SEOAdapter {
  readonly vendor: string;
  readonly workspaceId: string;

  keywordMetrics(keywords: string[], opts?: { country?: string }): Promise<KeywordMetrics[]>;
  relatedKeywords(seed: string, opts?: { limit?: number; country?: string }): Promise<KeywordMetrics[]>;
  backlinks(domain: string, opts?: { limit?: number }): Promise<BacklinkRow[]>;
  auditSite(domain: string, opts?: { maxUrls?: number }):
    Promise<{ jobId: string }>;
  getAuditIssues(jobId: string): Promise<SiteAuditIssue[] | null>;
  healthCheck(): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
