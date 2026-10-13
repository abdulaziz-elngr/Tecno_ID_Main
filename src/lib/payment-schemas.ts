import { z } from "zod";

/** Shared query schema for the Payment Records list and its Excel export. */
export const recordsQuerySchema = z.object({
  stageId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  q: z.string().trim().max(100).optional(),
  exact: z.enum(["1", "0"]).optional()
});
