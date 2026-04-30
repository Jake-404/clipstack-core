import { z } from "zod";

// A company is the top-level tenant.
// `type='agency'` rolls up multiple `type='client'` companies via parent_company_id.

export const CompanyTypeSchema = z.enum(["agency", "client", "in_house", "solo"]);
export type CompanyType = z.infer<typeof CompanyTypeSchema>;

export const UiModeSchema = z.enum(["web2", "web3"]);
export type UiMode = z.infer<typeof UiModeSchema>;

export const CompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  type: CompanyTypeSchema,
  parentCompanyId: z.string().uuid().nullable().optional(),
  uiMode: UiModeSchema.default("web2"),
  brandKitId: z.string().uuid().nullable().optional(),
  activeRegimes: z.array(z.string()).default([]), // e.g. ['mica', 'fca']
  contextJson: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Company = z.infer<typeof CompanySchema>;

export const CompanyCreateSchema = CompanySchema.pick({
  name: true,
  type: true,
  parentCompanyId: true,
  uiMode: true,
});
export type CompanyCreate = z.infer<typeof CompanyCreateSchema>;
