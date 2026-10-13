import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readQuery, NotFoundError } from "@/lib/api";
import { loadLedgerEnv, loadLedgers, serializeEntry, summarize } from "@/lib/payment-ledger";

const querySchema = z.object({ studentId: z.string().uuid() });

/** One student's full monthly ledger: history, outstanding months, next eligible month. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("payments.view");
    const { studentId } = readQuery(request, querySchema);

    const student = await db.student.findFirst({
      where: { id: studentId, organizationId: ctx.organizationId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        studentCode: true,
        photoUrl: true,
        enrollmentDate: true,
        branchId: true,
        gradeId: true,
        stage: { select: { id: true, name: true } },
        grade: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, subject: { select: { name: true } } } },
        parents: {
          orderBy: { isPrimary: "desc" },
          select: { relationship: true, parent: { select: { fullName: true, phone: true, whatsappNumber: true } } }
        }
      }
    });
    if (!student) throw new NotFoundError("Student not found.");
    resolveBranchScope(ctx, student.branchId);

    const env = await loadLedgerEnv(ctx.organizationId);
    const ledger = (await loadLedgers(ctx.organizationId, [student], env)).get(student.id) ?? [];
    const sum = summarize(ledger);

    return ok({
      student: {
        id: student.id,
        fullName: student.fullName,
        studentCode: student.studentCode,
        photoUrl: student.photoUrl,
        stage: student.stage,
        grade: student.grade,
        group: { id: student.group.id, name: student.group.name, subject: student.group.subject?.name ?? null },
        parents: student.parents.map((p) => ({
          name: p.parent.fullName,
          relationship: p.relationship,
          phone: p.parent.phone,
          whatsappNumber: p.parent.whatsappNumber ?? p.parent.phone
        }))
      },
      currency: env.currency,
      dueDay: env.dueDay,
      allowPartial: env.allowPartial,
      current: env.current,
      ledger: ledger.map(serializeEntry),
      outstanding: sum.outstanding.map(serializeEntry),
      nextEligible: sum.oldest ? serializeEntry(sum.oldest) : null,
      totalDue: sum.totalDue,
      lastPaidMonth: sum.lastPaidMonth,
      canRecord: ctx.permissions.has("payments.create"),
      canDiscount: ctx.permissions.has("payments.update")
    });
  } catch (err) {
    return handleApiError("payments.ledger", err);
  }
}
