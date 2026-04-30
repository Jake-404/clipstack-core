import { z } from "zod";

// USP 10 — per-output metering counter.
// One row per published artifact, written in the same transaction as publish.
// Powers per-publish billing and the public counter-of-output dashboard.

export const MeterEventKindSchema = z.enum([
  "publish",
  "metered_asset_generation",   // FREE/METERED/EXPENSIVE (CLAUDE.md cost policy)
  "x402_outbound_call",         // USP-C1 per-call procurement
  "x402_inbound_call",          // USP-C11 outbound monetization
  "voice_score_query",
  "compliance_check",
]);
export type MeterEventKind = z.infer<typeof MeterEventKindSchema>;

export const MeterEventSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  kind: MeterEventKindSchema,
  // Quantity in whichever unit makes sense for the kind:
  //   publish / asset_generation: 1 (count)
  //   x402_*:                     micro-USDC charged
  //   compliance_check:           1
  quantity: z.number().nonnegative(),
  unitCostUsd: z.number().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
  refKind: z.string().optional(),  // e.g. 'draft' | 'campaign'
  refId: z.string().optional(),    // FK target (no constraint at the schema layer)
  occurredAt: z.string().datetime(),
});
export type MeterEvent = z.infer<typeof MeterEventSchema>;
