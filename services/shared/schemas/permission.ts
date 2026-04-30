import { z } from "zod";

// Permission matrix: role × resource × action × allow/deny.
//
// Resources are strings (not enum) so new resource types can land without
// a schema migration. Action is a fixed enum — adding an action requires
// thinking through default policy for every existing role.
//
// `clientId` scopes a permission to a single client when the role grants
// limited access (e.g. `client_guest`). `null` means workspace-wide.

export const PermissionActionSchema = z.enum([
  "read",
  "create",
  "update",
  "delete",
  "approve",
  "deny",
  "publish",
  "invite",
  "revoke",
  "export",
  "admin",
]);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

export const PermissionResourceSchema = z.string().min(1).max(60).regex(/^[a-z0-9_]+$/);
export type PermissionResource = z.infer<typeof PermissionResourceSchema>;

// The standard resources the platform ships with. Custom resource strings
// are accepted by the schema; we enumerate the standard set here so callers
// have an authoritative reference.
export const STANDARD_RESOURCES = [
  "company",
  "user",
  "membership",
  "role",
  "permission",
  "agent",
  "lesson",
  "draft",
  "approval",
  "audit_log",
  "meter_event",
  "billing",
  "integration",
  "brand_kit",
  "campaign",
  "channel",
] as const;
export type StandardResource = (typeof STANDARD_RESOURCES)[number];

export const PermissionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  roleId: z.string().uuid(),
  resource: PermissionResourceSchema,
  action: PermissionActionSchema,
  allow: z.boolean().default(true),
  clientId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Permission = z.infer<typeof PermissionSchema>;

export const PermissionCheckRequestSchema = z.object({
  userId: z.string().uuid(),
  companyId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  resource: PermissionResourceSchema,
  action: PermissionActionSchema,
});
export type PermissionCheckRequest = z.infer<typeof PermissionCheckRequestSchema>;

export const PermissionCheckResponseSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum([
    "matched_allow",
    "matched_deny",
    "no_matching_rule",
    "no_membership",
    "membership_revoked",
  ]),
  matchedPermissionId: z.string().uuid().nullable().optional(),
});
export type PermissionCheckResponse = z.infer<typeof PermissionCheckResponseSchema>;
