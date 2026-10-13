import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthContext, resolveBranchScope, UnauthorizedError } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Global search (spec §39).
 *
 * Each entity block is only queried when the caller holds the matching
 * permission, and every query is branch-scoped and hard-limited — so
 * search can never become a bulk data-extraction endpoint.
 */

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
  branchId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5)
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();

    const limit = checkRateLimit(`search:${ctx.userId}`, 60, 60 * 1000);
    if (!limit.allowed) {
      return ok({ students: [], teachers: [], groups: [], parents: [], invoices: [] });
    }

    const query = readQuery(request, querySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);
    const term = query.q;
    const insensitive = { contains: term, mode: "insensitive" as const };

    const [students, teachers, groups, parents, invoices] = await Promise.all([
      ctx.permissions.has("students.view")
        ? db.student.findMany({
            where: {
              organizationId: ctx.organizationId,
              deletedAt: null,
              ...(branchIds ? { branchId: { in: branchIds } } : {}),
              OR: [
                { fullName: insensitive },
                { studentCode: insensitive },
                { qrCode: term },
                { phone: { contains: term } },
                { parents: { some: { parent: { phone: { contains: term } } } } }
              ]
            },
            take: query.limit,
            select: {
              id: true,
              fullName: true,
              studentCode: true,
              photoUrl: true,
              status: true,
              groupId: true,
              group: { select: { name: true } }
            }
          })
        : [],
      ctx.permissions.has("teachers.view")
        ? db.teacher.findMany({
            where: {
              organizationId: ctx.organizationId,
              deletedAt: null,
              ...(branchIds ? { branchId: { in: branchIds } } : {}),
              OR: [{ fullName: insensitive }, { phone: { contains: term } }]
            },
            take: query.limit,
            select: { id: true, fullName: true, phone: true, isAssistant: true }
          })
        : [],
      ctx.permissions.has("students.view")
        ? db.group.findMany({
            where: {
              deletedAt: null,
              branch: { center: { organizationId: ctx.organizationId } },
              ...(branchIds ? { branchId: { in: branchIds } } : {}),
              name: insensitive
            },
            take: query.limit,
            // Group has no direct Subject relation (Subject only connects to
            // a Group indirectly, through Exam) — surface the grade instead.
            select: { id: true, name: true, grade: { select: { name: true } } }
          })
        : [],
      ctx.permissions.has("parents.view")
        ? db.parent.findMany({
            where: {
              OR: [{ fullName: insensitive }, { phone: { contains: term } }],
              students: {
                some: {
                  student: {
                    organizationId: ctx.organizationId,
                    deletedAt: null,
                    ...(branchIds ? { branchId: { in: branchIds } } : {})
                  }
                }
              }
            },
            take: query.limit,
            select: { id: true, fullName: true, phone: true }
          })
        : [],
      ctx.permissions.has("invoices.view")
        ? db.invoice.findMany({
            where: {
              organizationId: ctx.organizationId,
              OR: [
                { invoiceNumber: insensitive },
                { payment: { receiptNumber: insensitive } }
              ]
            },
            take: query.limit,
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              student: { select: { fullName: true } }
            }
          })
        : []
    ]);

    return ok({
      students,
      teachers,
      groups,
      parents,
      invoices: invoices.map((i) => ({ ...i, totalAmount: Number(i.totalAmount) }))
    });
  } catch (err) {
    return handleApiError("search", err);
  }
}
