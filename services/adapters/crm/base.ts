// CRMAdapter — abstract contract every CRM concrete implements.
// Per Doc 6 §14. Mirror of services/adapters/crm/base.py.

export interface Contact {
  id: string;            // vendor-side id
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  title?: string;
  tags?: string[];
  customFields?: Record<string, string | number | boolean | null>;
  createdAt?: string;    // ISO-8601
  updatedAt?: string;
}

export type ActivityKind =
  | "email_sent"
  | "email_opened"
  | "email_replied"
  | "call_logged"
  | "meeting_booked"
  | "form_submitted"
  | "note_added"
  | "tag_added"
  | "tag_removed"
  | "deal_stage_changed";

export interface Activity {
  kind: ActivityKind;
  occurredAt: string;    // ISO-8601
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface ContactQuery {
  email?: string;
  externalId?: string;
  search?: string;       // free-text
  limit?: number;
}

export interface AdapterError {
  code: "rate_limited" | "auth_failed" | "not_found" | "invalid" | "unavailable";
  message: string;
  retryAfterSeconds?: number;
}

export interface CRMAdapter {
  /** Identity */
  readonly vendor: string;
  readonly workspaceId: string;

  /** Find a contact by email / external id / free-text. Returns null if not found. */
  findContact(query: ContactQuery): Promise<Contact | null>;

  /** Create or upsert a contact. Returns the vendor-side id. */
  upsertContact(contact: Omit<Contact, "id" | "createdAt" | "updatedAt">): Promise<string>;

  /** Log an activity against an existing contact. */
  logActivity(contactId: string, activity: Activity): Promise<void>;

  /** Add tags. Idempotent. */
  addTags(contactId: string, tags: string[]): Promise<void>;

  /** Remove tags. Idempotent. */
  removeTags(contactId: string, tags: string[]): Promise<void>;

  /** Health probe — used by the workspace settings page. */
  healthCheck(): Promise<{ ok: boolean; error?: AdapterError }>;
}
