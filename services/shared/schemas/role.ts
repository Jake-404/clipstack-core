import { z } from "zod";

// Workspace-scoped RBAC role definitions.
// Default roles are seeded per company in `db/migrations/0003_rbac_seed.sql`.
// Workspaces can clone defaults and add custom roles.

export const RoleSlugSchema = z.string().min(1).max(60).regex(/^[a-z0-9_]+$/);
export type RoleSlug = z.infer<typeof RoleSlugSchema>;

// The four defaults seeded for every workspace. Custom roles use any
// other slug matching the regex.
export const DEFAULT_ROLE_SLUGS = ["owner", "admin", "member", "client_guest"] as const;
export type DefaultRoleSlug = (typeof DEFAULT_ROLE_SLUGS)[number];

export const RoleSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  slug: RoleSlugSchema,
  displayName: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  isDefault: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type Role = z.infer<typeof RoleSchema>;

export const RoleCreateSchema = RoleSchema.pick({
  companyId: true,
  slug: true,
  displayName: true,
  description: true,
});
export type RoleCreate = z.infer<typeof RoleCreateSchema>;
