import { db } from "./db";
import { loadLedgerEnv, loadLedgers, summarize } from "./payment-ledger";
import { monthLabel } from "./subscription-months";

export interface PaymentWarning {
  currency: string;
  totalDue: number;
  months: { year: number; month: number; labelEn: string; labelAr: string; remaining: number; status: string }[];
}

/**
 * Outstanding subscription months for one student, or null when nothing is owed.
 * Used by attendance registration. Months that are only "upcoming" (not yet
 * past the due day) are still listed so the operator sees the whole picture;
 * each entry carries its status.
 */
export async function paymentWarningFor(organizationId: string, studentId: string): Promise<PaymentWarning | null> {
  const student = await db.student.findFirst({
    where: { id: studentId, organizationId, deletedAt: null },
    select: { id: true, gradeId: true, enrollmentDate: true }
  });
  if (!student) return null;
  const env = await loadLedgerEnv(organizationId);
  const ledger = (await loadLedgers(organizationId, [student], env)).get(student.id) ?? [];
  const sum = summarize(ledger);
  if (sum.outstanding.length === 0) return null;
  return {
    currency: env.currency,
    totalDue: sum.totalDue,
    months: sum.outstanding.map((e) => ({
      year: e.year,
      month: e.month,
      labelEn: monthLabel(e, "en"),
      labelAr: monthLabel(e, "ar"),
      remaining: e.remaining,
      status: e.status
    }))
  };
}
