import type { PerformanceReason } from "./performance";

/**
 * Pre-written messages that staff send to a parent/guardian through a WhatsApp
 * click-to-chat link (see wa-link.ts). Nothing is sent automatically — the link
 * only opens WhatsApp with this text prepared.
 *
 * Pure functions (no environment access). Arabic texts follow the student's
 * gender so the grammar is correct; English is gender-neutral.
 */

export type MessageLocale = "ar" | "en";
export type StudentGender = "MALE" | "FEMALE" | null | undefined;

/** Drops needless trailing zeros: 8 → "8", 7.5 → "7.5", 7.25 → "7.25". */
export function formatNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Human-readable calendar date for a message. Dates stored as a DATE column sit
 * at UTC midnight, so they are formatted in UTC; real instants (an exam's
 * date/time) should pass the centre's time zone.
 */
export function formatMessageDate(value: Date | string, locale: MessageLocale, timeZone = "UTC"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone
  }).format(date);
}

function arWords(gender: StudentGender) {
  const f = gender === "FEMALE";
  return {
    student: f ? "الطالبة" : "الطالب",
    got: f ? "حصلت" : "حصل",
    absent: f ? "تغيّبت" : "تغيّب",
    done: f ? "أنجزت" : "أنجز",
    notDone: f ? "لم تُنجز" : "لم يُنجز",
    forStudent: f ? "للطالبة" : "للطالب",
    pronoun: f ? "ها" : "ه"
  };
}

interface Base {
  locale: MessageLocale;
  studentName: string;
  gender?: StudentGender;
}

export function examResultMessage(
  p: Base & { examName: string; examDate: string; score: number; maxScore: number; subjectName?: string | null }
): string {
  const score = formatNumber(p.score);
  const max = formatNumber(p.maxScore);
  const pct = p.maxScore > 0 ? formatNumber((p.score / p.maxScore) * 100) : null;
  if (p.locale === "ar") {
    const w = arWords(p.gender);
    return (
      `عزيزي ولي أمر ${w.student} ${p.studentName}، نود إعلامكم بأن ${w.student} ${w.got} على ${score} من ${max}` +
      ` في امتحان ${p.examName}${p.subjectName ? ` (مادة ${p.subjectName})` : ""} بتاريخ ${p.examDate}` +
      `${pct !== null ? ` (النسبة ${pct}%)` : ""}.`
    );
  }
  return (
    `Dear parent/guardian of ${p.studentName}, we would like to inform you that the student received ${score} out of ${max}` +
    ` in the exam ${p.examName}${p.subjectName ? ` (${p.subjectName})` : ""} on ${p.examDate}${pct !== null ? ` (${pct}%)` : ""}.`
  );
}

export function examAbsentMessage(p: Base & { examName: string; examDate: string; subjectName?: string | null }): string {
  if (p.locale === "ar") {
    const w = arWords(p.gender);
    return (
      `عزيزي ولي أمر ${w.student} ${p.studentName}، نود إعلامكم بأن ${w.student} ${w.absent} عن امتحان ${p.examName}` +
      `${p.subjectName ? ` (مادة ${p.subjectName})` : ""} بتاريخ ${p.examDate}.`
    );
  }
  return (
    `Dear parent/guardian of ${p.studentName}, we would like to inform you that the student was absent from the exam ` +
    `${p.examName}${p.subjectName ? ` (${p.subjectName})` : ""} on ${p.examDate}.`
  );
}

export function recitationMessage(
  p: Base & { lessonNumber: number | null; date: string; score: number; maxScore: number }
): string {
  const score = formatNumber(p.score);
  const max = formatNumber(p.maxScore);
  if (p.locale === "ar") {
    const w = arWords(p.gender);
    return (
      `عزيزي ولي أمر ${w.student} ${p.studentName}، درجة تسميع ${w.student}` +
      `${p.lessonNumber !== null ? ` في الحصة رقم ${p.lessonNumber}` : ""} بتاريخ ${p.date} كانت ${score} من ${max}.`
    );
  }
  return (
    `Dear parent/guardian of ${p.studentName}, the student's recitation grade` +
    `${p.lessonNumber !== null ? ` for lesson/session ${p.lessonNumber}` : ""} on ${p.date} was ${score} out of ${max}.`
  );
}

export function homeworkMessage(
  p: Base & { homeworkName: string; date: string; lessonNumber: number | null; completed: boolean }
): string {
  if (p.locale === "ar") {
    const w = arWords(p.gender);
    return (
      `عزيزي ولي أمر ${w.student} ${p.studentName}، نود إعلامكم بأن ${w.student} ${p.completed ? w.done : w.notDone}` +
      ` الواجب «${p.homeworkName}» بتاريخ ${p.date}` +
      `${p.lessonNumber !== null ? `، المرتبط بالحصة رقم ${p.lessonNumber}` : ""}.`
    );
  }
  return (
    `Dear parent/guardian of ${p.studentName}, we would like to inform you that the student ` +
    `${p.completed ? "completed" : "did not complete"} the homework ${p.homeworkName} on ${p.date}` +
    `${p.lessonNumber !== null ? `, associated with lesson/session ${p.lessonNumber}` : ""}.`
  );
}

function reasonLine(locale: MessageLocale, r: PerformanceReason): string {
  const v = formatNumber(r.value);
  if (locale === "ar") {
    switch (r.code) {
      case "LOW_EXAM":
        return `متوسط درجاته في الامتحانات ${v}%`;
      case "LOW_HOMEWORK":
        return `نسبة إنجاز الواجبات ${v}%`;
      case "LOW_RECITATION":
        return `متوسط درجات التسميع ${v}%`;
      case "LOW_ATTENDANCE":
        return `نسبة الحضور ${v}%`;
      case "MISSED_EXAMS":
        return `التغيّب عن ${v} امتحان`;
      case "LOW_OVERALL":
        return `التقييم العام ${v}%`;
    }
  }
  switch (r.code) {
    case "LOW_EXAM":
      return `exam average ${v}%`;
    case "LOW_HOMEWORK":
      return `homework completion ${v}%`;
    case "LOW_RECITATION":
      return `recitation average ${v}%`;
    case "LOW_ATTENDANCE":
      return `attendance ${v}%`;
    case "MISSED_EXAMS":
      return `${v} missed exam(s)`;
    case "LOW_OVERALL":
      return `overall performance ${v}%`;
  }
}

/** Follow-up message for a student who needs attention, customised with their real figures. */
export function performanceMessage(p: Base & { reasons: PerformanceReason[] }): string {
  const lines = p.reasons.map((r) => `• ${reasonLine(p.locale, r)}`);
  if (p.locale === "ar") {
    const w = arWords(p.gender);
    return (
      `عزيزي ولي أمر ${w.student} ${p.studentName}، نود إعلامكم بأن المستوى الدراسي الحالي ${w.forStudent} يحتاج إلى مزيد من الاهتمام. ` +
      `بناءً على نتائج الامتحانات والواجبات والتسميع والحضور` +
      (lines.length > 0 ? `، لاحظنا الآتي:\n${lines.join("\n")}\n` : ". ") +
      `نوصي بمتابعة ${w.student} ودعم${w.pronoun} خلال الفترة القادمة، ونرحب بالتواصل معنا لأي استفسار.`
    );
  }
  return (
    `Dear parent/guardian of ${p.studentName}, we would like to inform you that the student's current academic performance requires additional attention. ` +
    `Based on recent exams, homework, recitations, and attendance` +
    (lines.length > 0 ? `, we noticed:\n${lines.join("\n")}\n` : ". ") +
    `We recommend following up with the student and supporting them during the coming period. Please contact us with any questions.`
  );
}
