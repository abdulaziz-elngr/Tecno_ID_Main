import { describe, expect, it } from "vitest";
import {
  examAbsentMessage,
  examResultMessage,
  formatNumber,
  homeworkMessage,
  performanceMessage,
  recitationMessage
} from "./parent-messages";
import { buildWhatsAppLink } from "./wa-link";

describe("parent messages", () => {
  it("formats numbers without needless zeros", () => {
    expect(formatNumber(8)).toBe("8");
    expect(formatNumber(7.5)).toBe("7.5");
    expect(formatNumber(7.256)).toBe("7.26");
  });

  it("writes the English exam result message from the spec", () => {
    const text = examResultMessage({
      locale: "en",
      studentName: "Ali",
      examName: "Monthly",
      examDate: "5 October 2026",
      score: 8,
      maxScore: 10
    });
    expect(text).toContain("Dear parent/guardian of Ali");
    expect(text).toContain("received 8 out of 10");
    expect(text).toContain("Monthly");
    expect(text).toContain("5 October 2026");
  });

  it("uses feminine Arabic grammar for female students", () => {
    const text = examAbsentMessage({
      locale: "ar",
      studentName: "سارة",
      gender: "FEMALE",
      examName: "الشهري",
      examDate: "٥ أكتوبر ٢٠٢٦"
    });
    expect(text).toContain("الطالبة سارة");
    expect(text).toContain("تغيّبت");
  });

  it("covers recitation and homework (completed / not completed)", () => {
    expect(recitationMessage({ locale: "en", studentName: "Ali", lessonNumber: 3, date: "d", score: 7, maxScore: 10 })).toContain(
      "lesson/session 3"
    );
    const done = homeworkMessage({ locale: "en", studentName: "Ali", homeworkName: "HW1", date: "d", lessonNumber: 2, completed: true });
    const notDone = homeworkMessage({ locale: "en", studentName: "Ali", homeworkName: "HW1", date: "d", lessonNumber: null, completed: false });
    expect(done).toContain("completed the homework HW1");
    expect(done).toContain("lesson/session 2");
    expect(notDone).toContain("did not complete the homework HW1");
    expect(notDone).not.toContain("lesson/session");
  });

  it("customises the performance message with the student's figures", () => {
    const text = performanceMessage({
      locale: "en",
      studentName: "Ali",
      reasons: [{ code: "LOW_ATTENDANCE", value: 60, threshold: 75 }]
    });
    expect(text).toContain("attendance 60%");
    expect(text).toContain("requires additional attention");
  });

  it("produces a wa.me link that survives URL encoding", () => {
    const text = examAbsentMessage({ locale: "ar", studentName: "علي", examName: "ا&ب", examDate: "x" });
    const link = buildWhatsAppLink("01012345678", text);
    expect(link?.startsWith("https://wa.me/201012345678?text=")).toBe(true);
    expect(decodeURIComponent(link!.split("?text=")[1])).toBe(text);
  });
});
