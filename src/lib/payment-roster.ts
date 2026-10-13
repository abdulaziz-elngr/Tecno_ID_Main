import { db } from "./db";
import type { Prisma } from "@prisma/client";
import { loadLedgers, loadLedgerEnv, summarize, serializeEntry, type LedgerEnv } from "./payment-ledger";
import { outstandingMonths, type LedgerEntry } from "./subscription-months";

export interface RosterFilters {
  organizationId: string;
  /** undefined = org-wide; otherwise the branches the caller may see. */
  branchIds?: string[];
  stageId?: string;
  gradeId?: string;
  groupId?: string;
  year: number;
  month: number;
  /** Free-text search: name (contains), student code / barcode. */
  q?: string;
  /** Exact code/barcode lookup that ignores the stage/grade/group filters (scanner use). */
  exact?: boolean;
  limit?: number;
}

export interface RosterRow {
  studentId: string;
  fullName: string;
  studentCode: string;
  photoUrl: string | null;
  stageId: string;
  stageName: string;
  gradeId: string;
  gradeName: string;
  groupId: string;
  groupName: string;
  subjectName: string | null;
  parentName: string | null;
  parentPhone: string | null;
  whatsappNumber: string | null;
  month: ReturnType<typeof serializeEntry>;
  outstanding: { year: number; month: number; amount: number; remaining: number; status: string }[];
  totalDue: number;
  oldestOutstanding: { year: number; month: number } | null;
  lastPaidMonth: { year: number; month: number } | null;
  payment: {
    id: string;
    receiptNumber: string;
    paidAt: Date;
    method: string;
    amount: number;
  } | null;
}

export interface Roster {
  paid: RosterRow[];
  unpaid: RosterRow[];
  totals: {
    paidCount: number;
    unpaidCount: number;
    collected: number;
    outstanding: number;
  };
  env: Pick<LedgerEnv, "currency" | "dueDay" | "allowPartial">;
}

export async function loadRoster(f: RosterFilters): Promise<Roster> {
  const env = await loadLedgerEnv(f.organizationId);
  const q = f.q?.trim();

  const where: Prisma.StudentWhereInput = {
    organizationId: f.organizationId,
    deletedAt: null,
    status: "ACTIVE",
    ...(f.branchIds ? { branchId: { in: f.branchIds } } : {})
  };

  if (q && f.exact) {
    where.OR = [{ qrCode: q }, { studentCode: q }];
  } else {
    if (f.stageId) where.stageId = f.stageId;
    if (f.gradeId) where.gradeId = f.gradeId;
    if (f.groupId) where.groupId = f.groupId;
    if (q) {
      where.AND = [
        {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { studentCode: { contains: q, mode: "insensitive" } },
            { qrCode: q }
          ]
        }
      ];
    }
  }

  const students = await db.student.findMany({
    where,
    orderBy: { fullName: "asc" },
    take: f.limit ?? 500,
    select: {
      id: true,
      fullName: true,
      studentCode: true,
      photoUrl: true,
      enrollmentDate: true,
      stageId: true,
      gradeId: true,
      groupId: true,
      stage: { select: { name: true } },
      grade: { select: { name: true } },
      group: { select: { name: true, subject: { select: { name: true } } } },
      parents: {
        orderBy: { isPrimary: "desc" },
        take: 1,
        select: { parent: { select: { fullName: true, phone: true, whatsappNumber: true } } }
      }
    }
  });

  const ledgers = await loadLedgers(
    f.organizationId,
    students.map((s) => ({ id: s.id, gradeId: s.gradeId, enrollmentDate: s.enrollmentDate })),
    env
  );

  // Payment details for months that are paid (one query for the whole page).
  const paidSubIds: string[] = [];
  const entryByStudent = new Map<string, LedgerEntry>();
  for (const s of students) {
    const entry = ledgers.get(s.id)?.find((e) => e.year === f.year && e.month === f.month);
    if (!entry) continue;
    entryByStudent.set(s.id, entry);
    if (entry.status === "PAID") paidSubIds.push(...entry.subscriptionIds);
  }

  const allocations = paidSubIds.length
    ? await db.paymentAllocation.findMany({
        where: {
          subscriptionId: { in: paidSubIds },
          payment: { status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] } }
        },
        orderBy: { createdAt: "desc" },
        select: {
          subscriptionId: true,
          payment: { select: { id: true, receiptNumber: true, paidAt: true, method: true, amount: true } }
        }
      })
    : [];
  const paymentBySub = new Map<string, (typeof allocations)[number]["payment"]>();
  for (const a of allocations) if (!paymentBySub.has(a.subscriptionId)) paymentBySub.set(a.subscriptionId, a.payment);

  const paid: RosterRow[] = [];
  const unpaid: RosterRow[] = [];

  for (const s of students) {
    const entry = entryByStudent.get(s.id);
    if (!entry) continue; // month not applicable to this student
    const ledger = ledgers.get(s.id) ?? [];
    const sum = summarize(ledger);
    const parent = s.parents[0]?.parent ?? null;
    const subId = entry.subscriptionIds.find((id) => paymentBySub.has(id));
    const pay = subId ? paymentBySub.get(subId)! : null;

    const row: RosterRow = {
      studentId: s.id,
      fullName: s.fullName,
      studentCode: s.studentCode,
      photoUrl: s.photoUrl,
      stageId: s.stageId,
      stageName: s.stage.name,
      gradeId: s.gradeId,
      gradeName: s.grade.name,
      groupId: s.groupId,
      groupName: s.group.name,
      subjectName: s.group.subject?.name ?? null,
      parentName: parent?.fullName ?? null,
      parentPhone: parent?.phone ?? null,
      whatsappNumber: parent?.whatsappNumber ?? parent?.phone ?? null,
      month: serializeEntry(entry),
      outstanding: outstandingMonths(ledger).map((e) => ({
        year: e.year,
        month: e.month,
        amount: e.amount,
        remaining: e.remaining,
        status: e.status
      })),
      totalDue: sum.totalDue,
      oldestOutstanding: sum.oldest ? { year: sum.oldest.year, month: sum.oldest.month } : null,
      lastPaidMonth: sum.lastPaidMonth,
      payment: pay
        ? { id: pay.id, receiptNumber: pay.receiptNumber, paidAt: pay.paidAt, method: pay.method, amount: Number(pay.amount) }
        : null
    };

    if (entry.status === "PAID" || entry.status === "WAIVED") paid.push(row);
    else unpaid.push(row);
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    paid,
    unpaid,
    totals: {
      paidCount: paid.length,
      unpaidCount: unpaid.length,
      collected: r2(paid.reduce((s, r) => s + r.month.paid, 0)),
      outstanding: r2(unpaid.reduce((s, r) => s + r.month.remaining, 0))
    },
    env: { currency: env.currency, dueDay: env.dueDay, allowPartial: env.allowPartial }
  };
}
