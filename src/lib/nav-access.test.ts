import { describe, it, expect } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions";
import { canOpenPath } from "./nav-access";

const hasFor = (role: string) => {
  const keys = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
  return (k: string) => keys.has(k);
};

describe("three-role navigation", () => {
  it("center owner can open everything", () => {
    const has = hasFor("CENTER_OWNER");
    for (const p of [
      "/dashboard/students",
      "/dashboard/academic",
      "/dashboard/finance/payments",
      "/dashboard/performance/exams",
      "/dashboard/users",
      "/dashboard/settings"
    ]) {
      expect(canOpenPath(p, has)).toBe(true);
    }
  });

  it("accountant gets finance pages plus a read-only view of students and groups", () => {
    const has = hasFor("ACCOUNTANT");
    expect(canOpenPath("/dashboard", has)).toBe(true);
    expect(canOpenPath("/dashboard/finance/subscriptions", has)).toBe(true);
    expect(canOpenPath("/dashboard/finance/payments", has)).toBe(true);
    expect(canOpenPath("/dashboard/finance/records", has)).toBe(true);
    expect(canOpenPath("/dashboard/finance/invoices", has)).toBe(true);
    // read-only lookups so students and groups are visible next to their payments
    expect(canOpenPath("/dashboard/students", has)).toBe(true);
    expect(canOpenPath("/dashboard/academic", has)).toBe(true);
    expect(canOpenPath("/dashboard/academic/groups/abc", has)).toBe(true);
    // ...but no write access to the academic structure
    expect(has("academic.fees.manage")).toBe(true);
    for (const k of ["students.update", "students.create", "students.delete", "academic.groups.manage"]) {
      expect(has(k)).toBe(false);
    }
    for (const p of [
      "/dashboard/academic/stages",
      "/dashboard/academic/lesson-formation",
      "/dashboard/academic/sessions",
      "/dashboard/attendance/scan",
      "/dashboard/performance/exams",
      "/dashboard/users",
      "/dashboard/settings",
      "/dashboard/teachers"
    ]) {
      expect(canOpenPath(p, has)).toBe(false);
    }
  });

  it("teaching assistant gets attendance / recitation / homework / exams / lesson formation but no finance or admin", () => {
    const has = hasFor("TEACHER_ASSISTANT");
    for (const p of [
      "/dashboard/attendance/scan",
      "/dashboard/academic/sessions",
      "/dashboard/performance/exams",
      "/dashboard/performance/recitation",
      "/dashboard/performance/assignments",
      "/dashboard/performance/students",
      "/dashboard/academic/lesson-formation"
    ]) {
      expect(canOpenPath(p, has)).toBe(true);
    }
    for (const p of [
      "/dashboard/finance/payments",
      "/dashboard/finance/subscriptions",
      "/dashboard/users",
      "/dashboard/settings",
      "/dashboard/teachers",
      "/dashboard/academic/stages"
    ]) {
      expect(canOpenPath(p, has)).toBe(false);
    }
  });
});
