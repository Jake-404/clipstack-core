import { z } from "zod";

// company_lessons row — USP 5 editorial memory.
// Captured on approval-deny + critic-block. Recalled into agent system prompts.

export const LessonScopeSchema = z.enum(["forever", "this_topic", "this_client"]);
export type LessonScope = z.infer<typeof LessonScopeSchema>;

export const LessonKindSchema = z.enum([
  "human_denied",       // human approver said no
  "critic_blocked",     // brand-QA / claim-verifier / compliance critic said no
  "policy_rule",        // explicit "always do X" / "never do Y" capture from settings
]);
export type LessonKind = z.infer<typeof LessonKindSchema>;

export const LessonSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  kind: LessonKindSchema,
  scope: LessonScopeSchema,
  rationale: z.string().min(20).max(2000), // USP 5 hard rule: rationale ≥ 20 chars
  topicTags: z.array(z.string()).default([]),
  // 384-d (MiniLM-L6-v2) or 1536-d (text-embedding-3-small) per workspace config.
  embedding: z.array(z.number()).optional(),
  capturedByUserId: z.string().uuid().nullable().optional(),
  capturedByAgentId: z.string().uuid().nullable().optional(),
  capturedAt: z.string().datetime(),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const LessonCreateSchema = LessonSchema.pick({
  companyId: true,
  clientId: true,
  kind: true,
  scope: true,
  rationale: true,
  topicTags: true,
  capturedByUserId: true,
  capturedByAgentId: true,
});
export type LessonCreate = z.infer<typeof LessonCreateSchema>;
