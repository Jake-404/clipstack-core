// AdsAdapter — paid-channel campaign management.
// Per Doc 6 §14. Wraps Meta / Google / TikTok / Pipeboard managed.

export type AdPlatform = "google" | "meta" | "tiktok" | "linkedin" | "x";

export interface Campaign {
  id: string;
  platform: AdPlatform;
  name: string;
  status: "draft" | "scheduled" | "live" | "paused" | "archived";
  budgetUsdDaily?: number;
  budgetUsdLifetime?: number;
  startAt?: string;          // ISO-8601
  endAt?: string;
  objective?: "awareness" | "traffic" | "engagement" | "conversion" | "lead";
  targeting?: Record<string, unknown>;
}

export interface AdCreative {
  id: string;
  campaignId: string;
  format: "image" | "video" | "carousel" | "text";
  headline?: string;
  body?: string;
  cta?: string;
  destinationUrl?: string;
  assetUrls?: string[];
}

export interface AdMetric {
  campaignId: string;
  date: string;              // ISO-8601 day
  impressions: number;
  clicks: number;
  spendUsd: number;
  conversions?: number;
  cpc?: number;
  cpm?: number;
}

export interface AdsAdapter {
  readonly vendor: string;
  readonly workspaceId: string;

  listCampaigns(filters?: { platform?: AdPlatform; status?: Campaign["status"] }):
    Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | null>;
  createCampaign(c: Omit<Campaign, "id">): Promise<string>;
  pauseCampaign(id: string): Promise<void>;
  resumeCampaign(id: string): Promise<void>;
  updateBudget(id: string, dailyUsd: number): Promise<void>;
  listCreatives(campaignId: string): Promise<AdCreative[]>;
  addCreative(creative: Omit<AdCreative, "id">): Promise<string>;
  metrics(query: { campaignIds: string[]; startAt: string; endAt: string }): Promise<AdMetric[]>;
  healthCheck(): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
