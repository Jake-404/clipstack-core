import { z } from "zod";

// An agent is a role-bound LLM persona. Per Doc 1 §7 + Doc 4 §2.6–§2.10.

export const AgentRoleSchema = z.enum([
  "orchestrator",       // Mira
  "researcher",
  "strategist",
  "long_form_writer",
  "social_adapter",
  "newsletter_adapter",
  "brand_qa",
  "devils_advocate_qa",
  "engagement",
  "lifecycle",
  "trend_detector",
  "algorithm_probe",
  "live_event_monitor",
  "claim_verifier",
  "compliance",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AgentStatusSchema = z.enum(["idle", "working", "blocked", "asleep", "fired"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  role: AgentRoleSchema,
  displayName: z.string().min(1).max(60),
  jobDescription: z.string().min(1).max(2000),
  status: AgentStatusSchema.default("idle"),
  modelProfile: z.string().min(1).default("WRITER_MODEL"),
  toolsAllowed: z.array(z.string()).default([]),
  spawnedAt: z.string().datetime(),
  retiredAt: z.string().datetime().nullable().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;
