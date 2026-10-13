import { type NextRequest } from "next/server";
import { z } from "zod";
import ExcelJS from "exceljs";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, readQuery } from "@/lib/api";
import { loadRoster, type RosterRow } from "@/lib/payment-roster";
import { monthLabel } from "@/lib/subscription-months";
import { writeAuditLog } from "@/lib/audit";
import { recordsQuerySchema } from "@/lib/payment-schemas";

const exportSchema = recordsQuerySchema.extend({
  section: z.enum(["paid", "unpaid"]),
  locale: z.enum(["ar", "en"]).default("ar")
});

const STATUS_AR: Record<string, string> = { PAID: "مدفوع", WAIVED: "معفى", UNPAID: "غير مدفوع", PARTIAL: "مدفوع جزئيًا", OVERDUE: "متأخر" };
const METHOD_AR: Record<string, string> = { CASH: "نقدي", BANK_TRANSFER: "تحويل بنكي", CARD: "بطاقة", OTHER: "أخرى" };

/** Excel (.xlsx) export of the paid OR unpaid list for the selected filters. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("payments.view");
    const q = readQuery(request, exportSchema);
    const branchIds = resolveBranchScope(ctx, q.branchId);
    const roster = await loadRoster({
      organizationId: ctx.organizationId,
      branchIds,
      stageId: q.stageId,
      gradeId: q.gradeId,
      groupId: q.groupId,
      year: q.year,
      month: q.month,
      limit: 5000
    });
    const rows: RosterRow[] = q.section === "paid" ? roster.paid : roster.unpaid;
    const ar = q.locale === "ar";
    const label = monthLabel({ year: q.year, month: q.month }, q.locale);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(ar ? (q.section === "paid" ? "المسددون" : "غير المسددين") : q.section === "paid" ? "Paid" : "Unpaid", {
      views: [{ rightToLeft: ar, state: "frozen", ySplit: 1 }]
    });
    ws.columns = ar
      ? [
          { header: "اسم الطالب", key: "name", width: 28 },
          { header: "كود الطالب", key: "code", width: 16 },
          { header: "المرحلة", key: "stage", width: 14 },
          { header: "الصف", key: "grade", width: 16 },
          { header: "المجموعة", key: "group", width: 14 },
          { header: "الشهر", key: "month", width: 16 },
          { header: "المبلغ", key: "amount", width: 12 },
          { header: "المسدد", key: "paid", width: 12 },
          { header: "المتبقي", key: "remaining", width: 12 },
          { header: "الحالة", key: "status", width: 14 },
          { header: "تاريخ الدفع", key: "paidAt", width: 20 },
          { header: "طريقة الدفع", key: "method", width: 14 },
          { header: "رقم الإيصال", key: "receipt", width: 20 },
          { header: "الأشهر المتأخرة", key: "outstanding", width: 36 }
        ]
      : [
          { header: "Student name", key: "name", width: 28 },
          { header: "Student code", key: "code", width: 16 },
          { header: "Stage", key: "stage", width: 14 },
          { header: "Grade", key: "grade", width: 16 },
          { header: "Group", key: "group", width: 14 },
          { header: "Month", key: "month", width: 16 },
          { header: "Amount", key: "amount", width: 12 },
          { header: "Paid", key: "paid", width: 12 },
          { header: "Remaining", key: "remaining", width: 12 },
          { header: "Status", key: "status", width: 14 },
          { header: "Payment date", key: "paidAt", width: 20 },
          { header: "Payment method", key: "method", width: 14 },
          { header: "Receipt no.", key: "receipt", width: 20 },
          { header: "Outstanding months", key: "outstanding", width: 36 }
        ];
    ws.getRow(1).font = { bold: true };

    for (const r of rows) {
      ws.addRow({
        name: r.fullName,
        // Stored as text so Excel never reformats codes; also neutralises formula injection.
        code: String(r.studentCode),
        stage: r.stageName,
        grade: r.gradeName,
        group: r.groupName,
        month: label,
        amount: r.month.amount - r.month.discount,
        paid: r.month.paid,
        remaining: r.month.remaining,
        status: ar ? STATUS_AR[r.month.status] ?? r.month.status : r.month.status,
        paidAt: r.payment?.paidAt ?? "",
        method: r.payment ? (ar ? METHOD_AR[r.payment.method] ?? r.payment.method : r.payment.method) : "",
        receipt: r.payment?.receiptNumber ?? "",
        outstanding: r.outstanding.map((o) => `${o.month}/${o.year}`).join(", ")
      });
    }
    // Neutralise spreadsheet formulas in free-text cells.
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (typeof cell.value === "string" && /^[=+\-@\t\r]/.test(cell.value)) cell.value = `'${cell.value}`;
      })
    );
    ws.getColumn("paidAt").numFmt = "yyyy-mm-dd hh:mm";

    const buffer = await wb.xlsx.writeBuffer();

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "EXPORT_PAYMENT_RECORDS",
      entityType: "Payment",
      afterValue: { section: q.section, month: `${q.year}-${q.month}`, rows: rows.length }
    });

    const filename = `payment-records-${q.section}-${q.year}-${String(q.month).padStart(2, "0")}.xlsx`;
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    return handleApiError("payment-records.export", err);
  }
}
