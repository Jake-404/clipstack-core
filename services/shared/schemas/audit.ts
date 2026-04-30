import { z } from "zod";

// audit_log — append-only record of every state change of significance.
// Existing schema in the legacy stack survives wholesale (Doc 5 §1.6 alignment).

export const AuditActorKindSchema = z.enum(["user", "agent", "system"]);
export type AuditActorKind = z.infer<typeof AuditActorKindSchema>;

export const AuditEventKindSchema = z.enum([
  "company.created",
  "company.updated",
  "agent.spawned",
  "agent.fired",
  "approval.created",
  "approval.approved",
  "approval.denied",
  "lesson.recorded",
  "draft.published",
  "draft.scheduled",
  "metered.debited",
  "compliance.blocked",
  "voice.scored",
  "trend.dismissed",
  "skill.installed",
  "x402.outbound_paid",
  "x402.inbound_charged",
]);
export type AuditEventKind = z.infer<typeof AuditEventKindSchema>;

export const AuditLogRowSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  kind: AuditEventKindSchema,
  actorKind: AuditActorKindSchema,
  actorId: z.string().nullable().optional(),
  detailsJson: z.record(z.unknown()).default({}),
  // Layer A zk commitment (weeks 9–10 per scoping doc).
  // Poseidon hash of (kind, actorId, detailsJson, timestamp). Optional in A.0.
  commitmentHash: z.string().nullable().optional(),
  // Distributed tracing — Langfuse trace ID round-trips here.
  traceId: z.string().nullable().optional(),
  occurredAt: z.string().datetime(),
});
export type AuditLogRow = z.infer<typeof AuditLogRowSchema>;
