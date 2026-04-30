// EmailAdapter — newsletter sends + transactional email.
// Per Doc 6 §14. Wraps Listmonk / Mautic / Postmark / Resend / SES.

export interface EmailList {
  id: string;
  name: string;
  subscriberCount?: number;
  tags?: string[];
}

export interface EmailCampaign {
  id: string;
  name: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "paused" | "failed";
  subjectLine: string;
  fromName?: string;
  fromEmail?: string;
  bodyHtml?: string;
  bodyText?: string;
  scheduledAt?: string;
  sentAt?: string;
  listId?: string;
}

export interface EmailMetric {
  campaignId: string;
  sent: number;
  opens: number;
  clicks: number;
  bounces: number;
  unsubscribes: number;
  spamComplaints?: number;
}

export interface EmailAdapter {
  readonly vendor: string;
  readonly workspaceId: string;

  listLists(): Promise<EmailList[]>;
  listCampaigns(filters?: { status?: EmailCampaign["status"]; limit?: number }):
    Promise<EmailCampaign[]>;
  getCampaign(id: string): Promise<EmailCampaign | null>;
  createCampaign(c: Omit<EmailCampaign, "id" | "status" | "sentAt">): Promise<string>;
  schedule(id: string, sendAt: string): Promise<void>;
  sendNow(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  metrics(campaignId: string): Promise<EmailMetric>;
  sendTransactional(opts: {
    to: string | string[];
    subject: string;
    bodyHtml?: string;
    bodyText?: string;
    fromName?: string;
    fromEmail?: string;
    metadata?: Record<string, string>;
  }): Promise<{ messageId: string }>;
  healthCheck(): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
