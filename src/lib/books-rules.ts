const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Pure book-reservation money rules (no database) so they are unit-testable. */
export type BookItemStatusValue = "UNPAID" | "PARTIAL" | "RESERVED" | "PAID";

export function bookPayable(price: number, discount: number): number {
  return round2(Math.max(0, price - discount));
}

export function bookRemaining(price: number, discount: number, paid: number): number {
  return round2(Math.max(0, bookPayable(price, discount) - paid));
}

export function computeBookStatus(input: {
  price: number;
  discount: number;
  paid: number;
  reservationFee: number;
}): BookItemStatusValue {
  const payable = bookPayable(input.price, input.discount);
  if (input.paid >= payable) return "PAID";
  if (input.paid <= 0) return "UNPAID";
  // The fee can never demand more than the student actually has to pay.
  const fee = Math.min(input.reservationFee, payable);
  return input.paid >= fee ? "RESERVED" : "PARTIAL";
}

