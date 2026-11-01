/**
 * Translations for "خصم مبلغ" (treasury deductions) and the book / notes reservations.
 * One table [arabic, english] per key, so the two languages can never drift apart.
 * Spread into DICTIONARIES (src/lib/i18n.tsx).
 */
const T = {
  "nav.books": ["حجوزات الكتب والمذكرات", "Book & Notes Reservations"],
  "nav.deductions": ["خصم مبلغ", "Deduct Amount"],

  // ---- treasury / deductions
  "tre.title": ["خصم مبلغ", "Deduct Amount"],
  "tre.subtitle": [
    "سجّل أي مبلغ اتسحب من الخزنة لاحتياج السنتر أو لحاجة اشترتها الإدارة. المبلغ بيتخصم تلقائيًا من إجمالي المبلغ ومن فلوس الشهر.",
    "Record any money taken from the treasury for the center's needs or a purchase by management. It is deducted automatically from the total and the month's money."
  ],
  "tre.new": ["خصم مبلغ جديد", "New deduction"],
  "tre.confirmDeduct": ["تأكيد الخصم", "Confirm deduction"],
  "tre.totalBalance": ["إجمالي المبلغ (بعد الخصم)", "Total balance (after deductions)"],
  "tre.income": ["الإيرادات", "Income"],
  "tre.deductions": ["الخصومات", "Deductions"],
  "tre.tuition": ["اشتراكات", "Tuition"],
  "tre.books": ["كتب ومذكرات", "Books & notes"],
  "tre.net": ["الصافي", "Net"],
  "tre.monthIncome": ["إيراد الشهر", "Month income"],
  "tre.monthDeductions": ["خصومات الشهر", "Month deductions"],
  "tre.monthNet": ["صافي فلوس الشهر", "Month net money"],
  "tre.openDeductions": ["فتح صفحة خصم مبلغ", "Open the deductions page"],
  "tre.linkedHint": [
    "الأرقام دي مربوطة ببعضها: أي خصم جديد بينزل من الإجمالي ومن صافي الشهر في لوحة التحكم وسجل المدفوعات والتقارير، وإلغاء الخصم بيرجّع المبلغ.",
    "These figures are linked: a new deduction lowers the total and the month net on the dashboard, payment records and reports, and voiding it restores the amount."
  ],
  "tre.category": ["التصنيف", "Category"],
  "tre.allCategories": ["كل التصنيفات", "All categories"],
  "tre.allTime": ["عرض كل الخصومات (بدون تحديد شهر)", "Show all deductions (any month)"],
  "tre.searchPh": ["ابحث بالبند أو المورد أو الرقم المرجعي", "Search item, vendor or reference"],
  "tre.colRef": ["الرقم المرجعي", "Reference"],
  "tre.colTitle": ["البند (اتخصم لإيه؟)", "Item (what was it for?)"],
  "tre.colWho": ["طلب / تسجيل", "Requested / recorded by"],
  "tre.titleHint": ["مثال: شراء مراوح، صيانة تكييف، طباعة أوراق", "e.g. buying fans, AC maintenance, printing papers"],
  "tre.vendor": ["المورد / المحل", "Vendor / shop"],
  "tre.requestedBy": ["طلب من (الإدارة / الشخص)", "Requested by"],
  "tre.empty": ["لا توجد خصومات.", "No deductions."],
  "tre.balanceNow": ["الرصيد الحالي", "Current balance"],
  "tre.thisDeduction": ["هذا الخصم", "This deduction"],
  "tre.balanceAfter": ["الرصيد بعد الخصم", "Balance after"],
  "tre.errTitle": ["اكتب البند (اتخصم لإيه).", "Enter what the deduction is for."],
  "tre.errAmount": ["اكتب مبلغ صحيح أكبر من صفر.", "Enter a valid amount above zero."],
  "tre.errBalance": ["المبلغ أكبر من الرصيد المتاح في الخزنة.", "The amount is more than the available treasury balance."],
  "tre.saved": ["تم خصم المبلغ من الخزنة", "Amount deducted from the treasury"],
  "tre.void": ["إلغاء الخصم", "Void deduction"],
  "tre.voidTitle": ["إلغاء الخصم", "Void deduction"],
  "tre.voidMsg": ["هيرجع المبلغ للإجمالي وفلوس الشهر. اكتب سبب الإلغاء.", "The amount returns to the total and the month's money. Enter a reason."],
  "tre.voidReason": ["سبب الإلغاء", "Void reason"],
  "tre.voided": ["تم إلغاء الخصم", "Deduction voided"],
  "tre.st.ACTIVE": ["سارٍ", "Active"],
  "tre.st.VOIDED": ["ملغي", "Voided"],
  "tre.cat.EQUIPMENT": ["أجهزة ومعدات", "Equipment"],
  "tre.cat.SUPPLIES": ["أدوات ومستلزمات", "Supplies"],
  "tre.cat.MAINTENANCE": ["صيانة", "Maintenance"],
  "tre.cat.CLEANING": ["نظافة", "Cleaning"],
  "tre.cat.UTILITIES": ["كهرباء ومياه وإنترنت", "Utilities"],
  "tre.cat.PRINTING": ["طباعة وتصوير", "Printing"],
  "tre.cat.TRANSPORT": ["مواصلات", "Transport"],
  "tre.cat.HOSPITALITY": ["ضيافة", "Hospitality"],
  "tre.cat.OTHER": ["أخرى", "Other"],

  // ---- books & notes reservations
  "bk.title": ["حجوزات الكتب والمذكرات", "Book & Notes Reservations"],
  "bk.subtitle": [
    "أنشئ حجز كتاب أو مذكرة لمجموعة، وتابع مين دفع ومين لسه، وحصّل المبالغ واطبع الإيصال. ولي الأمر بيشوف المطلوب منه في بوابة الطالب.",
    "Create a book or notes reservation for a group, track who paid, collect and print receipts. The guardian sees what is due in the student portal."
  ],
  "bk.new": ["إنشاء حجز كتاب", "New book reservation"],
  "bk.create": ["إنشاء الحجز", "Create reservation"],
  "bk.created": ["تم إنشاء الحجز وإضافة طلاب المجموعة", "Reservation created and the group's students added"],
  "bk.createHint": [
    "هيتضاف تلقائيًا كل طلاب المجموعة. مبلغ الحجز بيتحسب من سعر الكتاب (مش زيادة عليه)، والمتبقي = السعر − المدفوع.",
    "All students of the group are added automatically. The reservation fee counts toward the price (not on top of it); remaining = price − paid."
  ],
  "bk.bookName": ["اسم الكتاب / المذكرة", "Book / notes name"],
  "bk.type": ["النوع", "Type"],
  "bk.kind.BOOK": ["كتاب", "Book"],
  "bk.kind.NOTES": ["مذكرة", "Notes"],
  "bk.price": ["سعر الكتاب", "Book price"],
  "bk.fee": ["سعر الحجز", "Reservation fee"],
  "bk.feeHint": ["أقل مبلغ يثبّت الحجز (اختياري).", "Minimum that secures the reservation (optional)."],
  "bk.dueDate": ["آخر موعد للدفع", "Payment deadline"],
  "bk.searchPh": ["ابحث باسم الكتاب", "Search by book name"],
  "bk.searchStudent": ["ابحث باسم الطالب أو كوده", "Search student name or code"],
  "bk.reservationsCount": ["عدد الحجوزات", "Reservations"],
  "bk.studentsCount": ["الطلاب", "Students"],
  "bk.collected": ["المحصّل", "Collected"],
  "bk.remaining": ["المتبقي", "Remaining"],
  "bk.paid": ["المدفوع", "Paid"],
  "bk.paidSoFar": ["إجمالي المدفوع", "Total paid"],
  "bk.progress": ["نسبة التحصيل", "Collection progress"],
  "bk.notPaidShort": ["لم يدفع", "Not paid"],
  "bk.empty": ["لا توجد حجوزات.", "No reservations."],
  "bk.emptyHint": ["أنشئ حجز كتاب جديد لمجموعة لتبدأ.", "Create a new reservation for a group to start."],
  "bk.back": ["كل الحجوزات", "All reservations"],
  "bk.noStudents": ["لا يوجد طلاب في هذا العرض.", "No students in this view."],
  "bk.leftGroup": ["خرج من المجموعة", "Left the group"],
  "bk.discount": ["خصم", "Discount"],
  "bk.discountAmount": ["قيمة الخصم على هذا الطالب", "Discount for this student"],
  "bk.delivery": ["التسليم", "Delivery"],
  "bk.delivered": ["تم التسليم", "Delivered"],
  "bk.markDelivered": ["تم تسليم الكتاب", "Mark delivered"],
  "bk.collect": ["تحصيل", "Collect"],
  "bk.confirmCollect": ["تأكيد التحصيل", "Confirm"],
  "bk.collectedOk": ["تم التحصيل", "Collected"],
  "bk.payFee": ["دفع مبلغ الحجز", "Pay reservation fee"],
  "bk.payAll": ["دفع المتبقي كله", "Pay the rest"],
  "bk.printAfter": ["طباعة الإيصال بعد التحصيل", "Print the receipt after collecting"],
  "bk.history": ["الدفعات", "Payments"],
  "bk.voidPayment": ["إلغاء الدفعة", "Void payment"],
  "bk.voidPaymentMsg": ["هيتخصم من المدفوع وترجع حالة الطالب. اكتب السبب.", "It is removed from the paid total and the student's status is recomputed. Enter a reason."],
  "bk.paymentVoided": ["تم إلغاء الدفعة", "Payment voided"],
  "bk.voided": ["ملغاة", "Voided"],
  "bk.close": ["إغلاق الحجز", "Close reservation"],
  "bk.reopen": ["إعادة فتح الحجز", "Re-open reservation"],
  "bk.closeMsg": ["بعد الإغلاق لا يمكن تحصيل مبالغ جديدة ولا تظهر مطالبات لولي الأمر.", "After closing, no new payments can be collected and guardians no longer see a due amount."],
  "bk.reopenMsg": ["هيرجع الحجز مفتوح للتحصيل.", "The reservation becomes open for collection again."],
  "bk.editHint": [
    "تغيير السعر بيتطبق على كل الطلاب وبتتحدث حالة كل طالب حسب المدفوع.",
    "A new price applies to every student and each status is recomputed from what was paid."
  ],
  "bk.res.OPEN": ["مفتوح", "Open"],
  "bk.res.CLOSED": ["مغلق", "Closed"],
  "bk.res.CANCELLED": ["ملغي", "Cancelled"],
  "bk.st.UNPAID": ["لم يدفع", "Not paid"],
  "bk.st.PARTIAL": ["دفع جزء (الحجز لم يكتمل)", "Partly paid (not reserved yet)"],
  "bk.st.RESERVED": ["تم الحجز", "Reserved"],
  "bk.st.PAID": ["مدفوع بالكامل", "Fully paid"],
  "bk.tab.ALL": ["الكل", "All"],
  "bk.tab.PAID": ["دفع بالكامل", "Fully paid"],
  "bk.tab.RESERVED": ["محجوز (متبقي مبلغ)", "Reserved (balance due)"],
  "bk.tab.UNPAID": ["لم يدفع", "Not paid"],
  "bk.receiptTitle": ["إيصال كتاب / مذكرة", "Book / Notes Receipt"],
  "bk.errTitle": ["اكتب اسم الكتاب أو المذكرة.", "Enter the book or notes name."],
  "bk.errGroup": ["اختر المرحلة والصف والمجموعة.", "Choose the stage, grade and group."],
  "bk.errPrice": ["اكتب سعر الكتاب.", "Enter the book price."],
  "bk.errFee": ["تأكد من السعر ومبلغ الحجز (مبلغ الحجز لا يزيد عن السعر).", "Check the price and fee (the fee cannot exceed the price)."],
  "bk.errDuplicate": ["يوجد حجز بنفس الاسم لهذه المجموعة.", "A reservation with this name already exists for this group."],
  "bk.errCollectAmount": ["المبلغ لازم يكون أكبر من صفر ولا يزيد عن المتبقي.", "The amount must be above zero and not more than the remaining."],
  "bk.errDiscount": ["الخصم لا يزيد عن سعر الكتاب.", "The discount cannot exceed the price."],
  "bk.errHasPayments": ["الحجز عليه دفعات. ألغِ الدفعات أولًا أو أغلق الحجز.", "This reservation has payments. Void them first, or close it."],
  "bk.waHello": ["السلام عليكم", "Hello"],
  "bk.waBody": ["نفيدكم بوجود مبلغ متبقي لحجز", "A balance remains for the reservation of"],
  "bk.waStudent": ["للطالب", "for student"]
} as const satisfies Record<string, readonly [string, string]>;

type Key = keyof typeof T;

function pick(i: 0 | 1): Record<Key, string> {
  const out = {} as Record<Key, string>;
  for (const k of Object.keys(T) as Key[]) out[k] = T[k][i];
  return out;
}

export const TREASURY_AR = pick(0);
export const TREASURY_EN = pick(1);
