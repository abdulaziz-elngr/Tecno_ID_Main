import { db } from "./db";
import { round2 } from "./billing";

/**
 * Book / notes reservations — pure money rules + a few shared helpers.
 *
 * remaining = max(0, price - discount - paid)
 * status:   PAID      remaining is 0
 *           RESERVED  paid covers the reservation fee (any payment when the fee is 0)
 *           PARTIAL   paid something, but less than the reservation fee
 *           UNPAID    nothing paid
 */

export { bookPayable, bookRemaining, computeBookStatus, type BookItemStatusValue } from "./books-rules";
import { bookPayable, bookRemaining } from "./books-rules";

/** Next free `BK-YYYYMM-00001` receipt number (the unique index is the real guarantee). */
export async function nextBookReceiptNumber(organizationId: string, now = new Date()): Promise<string> {
  const prefix = `BK-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const count = await db.bookPayment.count({ where: { organizationId, receiptNumber: { startsWith: prefix } } });
    const candidate = `${prefix}-${String(count + 1 + attempt).padStart(5, "0")}`;
    const exists = await db.bookPayment.findUnique({ where: { receiptNumber: candidate } });
    if (!exists) return candidate;
  }
  throw new Error("Could not allocate a unique book receipt number.");
}

/** Serializable projection of one reservation row (used by staff pages, the student card and the parent portal). */
export function serializeBookItem(
  item: { id: string; price: unknown; discount: unknown; paidAmount: unknown; status: string; deliveredAt: Date | null },
  reservation: { id: string; title: string; kind: string; reservationFee: unknown; dueDate: Date | null; status: string }
) {
  const price = Number(item.price);
  const discount = Number(item.discount);
  const paid = Number(item.paidAmount);
  return {
    itemId: item.id,
    reservationId: reservation.id,
    title: reservation.title,
    kind: reservation.kind,
    reservationStatus: reservation.status,
    price,
    discount,
    payable: bookPayable(price, discount),
    reservationFee: Number(reservation.reservationFee),
    paid,
    remaining: bookRemaining(price, discount, paid),
    status: item.status,
    dueDate: reservation.dueDate,
    deliveredAt: item.deliveredAt
  };
}

/**
 * Makes sure every ACTIVE student of the reservation's group has a row.
 * Called whenever a reservation or a student's books are opened, so a student who joined the
 * group after the reservation was created still shows up (and is asked to pay).
 * Returns how many rows were created.
 */
export async function ensureReservationItems(reservation: {
  id: string;
  organizationId: string;
  groupId: string;
  bookPrice: unknown;
}): Promise<number> {
  const students = await db.student.findMany({
    where: { organizationId: reservation.organizationId, groupId: reservation.groupId, deletedAt: null, status: "ACTIVE" },
    select: { id: true }
  });
  if (students.length === 0) return 0;
  const res = await db.bookReservationItem.createMany({
    data: students.map((s) => ({ reservationId: reservation.id, studentId: s.id, price: Number(reservation.bookPrice) })),
    skipDuplicates: true
  });
  return res.count;
}

/** Same guarantee from the student's side: rows for every OPEN reservation of his current group. */
export async function ensureStudentItems(student: { id: string; organizationId: string; groupId: string; status: string }): Promise<void> {
  if (student.status !== "ACTIVE") return;
  const open = await db.bookReservation.findMany({
    where: { organizationId: student.organizationId, groupId: student.groupId, status: "OPEN" },
    select: { id: true, bookPrice: true }
  });
  if (open.length === 0) return;
  await db.bookReservationItem.createMany({
    data: open.map((r) => ({ reservationId: r.id, studentId: student.id, price: Number(r.bookPrice) })),
    skipDuplicates: true
  });
}
