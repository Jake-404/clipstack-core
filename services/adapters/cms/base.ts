// CMSAdapter — abstract contract every headless-CMS concrete implements.
// Per Doc 6 §14. Mirror of services/adapters/cms/base.py.

export type CmsResourceKind = "post" | "page" | "asset" | "snippet" | "redirect";

export interface CmsResource {
  id: string;
  kind: CmsResourceKind;
  slug: string;
  title?: string;
  body?: string;        // markdown / mdx / html depending on vendor
  status: "draft" | "scheduled" | "published" | "archived";
  publishedAt?: string; // ISO-8601
  scheduledAt?: string;
  authorId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CmsListQuery {
  kind?: CmsResourceKind;
  status?: CmsResource["status"];
  tag?: string;
  search?: string;
  cursor?: string;
  limit?: number;       // default 50
}

export interface CmsListResult {
  items: CmsResource[];
  nextCursor?: string;
}

export interface CMSAdapter {
  readonly vendor: string;
  readonly workspaceId: string;

  list(query?: CmsListQuery): Promise<CmsListResult>;
  get(id: string): Promise<CmsResource | null>;
  create(resource: Omit<CmsResource, "id">): Promise<string>;
  update(id: string, patch: Partial<CmsResource>): Promise<void>;
  publish(id: string, publishAt?: string): Promise<void>;
  unpublish(id: string): Promise<void>;
  uploadAsset(file: { filename: string; bytes: Uint8Array; contentType: string }): Promise<{ id: string; url: string }>;
  healthCheck(): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
