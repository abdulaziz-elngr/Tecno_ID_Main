/**
 * TecnoID seed script — DEVELOPMENT / DEMO DATA ONLY.
 *
 * Creates:
 *  - A demo Organization -> Center -> Branch
 *  - All default roles with the permission catalog wired up
 *  - A few demo users (one per key role), each with a real Argon2id hash
 *  - The full Stage -> Grade -> Group academic hierarchy from the spec
 *    example (Primary/Preparatory/Secondary, with Secondary -> Grade 3
 *    -> G1..G4), each group with its own weekly schedule and capacity
 *  - Per-Stage subscription fees (Settings -> Subscription Fees)
 *  - A handful of demo students enrolled directly into groups
 *  - Sessions, attendance (incl. one make-up), exams, recitation,
 *    assignments, subscriptions, payments, expenses and notification
 *    templates
 *
 * Run with: npm run db:seed
 *
 * DO NOT run this against a production database. Every record here
 * is clearly demo data (see the "Demo" prefixes) and must not be
 * relied on as real tenant data.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
} from "../src/lib/permissions";
import { generateStudentCode, buildQrPayload } from "../src/lib/student-code";
import { DEFAULT_TEMPLATES } from "../src/lib/templates";

const db = new PrismaClient();

async function main() {
  console.log("Seeding TecnoID demo data...");

  const org = await db.organization.upsert({
    where: { slug: "demo-org" },
    update: {},
    create: { name: "Demo Educational Group", slug: "demo-org" },
  });

  const center = await db.center.create({
    data: {
      organizationId: org.id,

      name: "Demo Learning Center",

      currency: "EGP",

      timezone: "Africa/Cairo",
    },
  });

  const branch = await db.branch.create({
    data: {
      centerId: center.id,
      name: "Main Branch",
      address: "Demo Street 1",
    },
  });

  // --- Permission catalog ---

  await db.permission.createMany({
    data: ALL_PERMISSION_KEYS.map((key) => ({
      key,

      module: key.split(".")[0]!,
    })),

    skipDuplicates: true,
  });

  const allPermissions = await db.permission.findMany();

  const permissionByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  // --- Roles + role-permission mapping ---

  const roleIdByName = new Map<string, string>();

  for (const [roleName, permissionKeys] of Object.entries(
    DEFAULT_ROLE_PERMISSIONS,
  )) {
    const role = await db.role.create({
      data: { organizationId: org.id, name: roleName, isSystem: true },
    });
    roleIdByName.set(roleName, role.id);

    await db.rolePermission.createMany({
      data: permissionKeys
        .map((key) => permissionByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  // --- Demo users (one per key role) ---
  const demoUsers = [
    {
      name: "Demo Owner",
      email: "owner@demo.tecnoid.local",
      role: "CENTER_OWNER",
    },
    {
      name: "Demo Manager",
      email: "manager@demo.tecnoid.local",
      role: "MANAGER",
    },
    {
      name: "Demo Teacher",
      email: "teacher@demo.tecnoid.local",
      role: "TEACHER",
    },
    {
      name: "Demo Receptionist",
      email: "reception@demo.tecnoid.local",
      role: "RECEPTIONIST",
    },
    {
      name: "Demo Accountant",
      email: "accountant@demo.tecnoid.local",
      role: "ACCOUNTANT",
    },
  ];
  const demoPassword = "Demo#Pass123"; // demo only — rotate before any real use

  for (const u of demoUsers) {
    const passwordHash = await hashPassword(demoPassword);
    const user = await db.user.create({
      data: {
        organizationId: org.id,
        fullName: u.name,
        email: u.email,
        passwordHash,
      },
    });
    const roleId = roleIdByName.get(u.role);
    if (roleId) {
      await db.userRole.create({ data: { userId: user.id, roleId } });
    }
    if (u.role !== "CENTER_OWNER" && u.role !== "MANAGER") {
      await db.userBranch.create({
        data: { userId: user.id, branchId: branch.id },
      });
    }
  }

  // ==========================================================
  // ACADEMIC HIERARCHY — Stage -> Grade -> Group (spec §2, §3)
  // ==========================================================
  console.log("Seeding academic hierarchy (Stages -> Grades -> Groups)...");

  const stageDefs: {
    name: string;
    order: number;
    grades: string[];
    fee: number;
  }[] = [
    {
      name: "Primary",
      order: 0,
      grades: [
        "Grade 1",
        "Grade 2",
        "Grade 3",
        "Grade 4",
        "Grade 5",
        "Grade 6",
      ],
      fee: 150,
    },
    {
      name: "Preparatory",
      order: 1,
      grades: ["Grade 1", "Grade 2", "Grade 3"],
      fee: 200,
    },
    {
      name: "Secondary",
      order: 2,
      grades: ["Grade 1", "Grade 2", "Grade 3"],
      fee: 300,
    },
  ];

  const stageByName = new Map<string, { id: string }>();
  const gradeByKey = new Map<string, { id: string; stageId: string }>();

  for (const def of stageDefs) {
    const stage = await db.stage.create({
      data: { organizationId: org.id, name: def.name, order: def.order },
    });
    stageByName.set(def.name, stage);

    // Settings -> Subscription Fees: one active fee per Stage (spec §17).
    await db.subscriptionFee.create({
      data: {
        organizationId: org.id,
        stageId: stage.id,
        amount: def.fee,
        effectiveFrom: new Date(),
      },
    });

    for (const [index, gradeName] of def.grades.entries()) {
      const grade = await db.grade.create({
        data: { stageId: stage.id, name: gradeName, order: index },
      });
      gradeByKey.set(`${def.name}::${gradeName}`, grade);
    }
  }

  const subject = await db.subject.create({
    data: { organizationId: org.id, name: "Mathematics", code: "MATH" },
  });

  // --- Demo teachers ---
  const teacher = await db.teacher.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      fullName: "Demo Teacher",
      phone: "+201000000001",
      isAssistant: false,
    },
  });
  // Subject -> Teacher: the demo teacher teaches Mathematics.
  await db.teacherSubject.create({
    data: { teacherId: teacher.id, subjectId: subject.id },
  });
  const assistant = await db.teacher.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      fullName: "Demo Assistant",
      phone: "+201000000002",
      isAssistant: true,
    },
  });

  // Secondary -> Grade 3 -> G1, G2, G3, G4 (the exact spec §3 example),
  // each with its own capacity + weekly schedule.
  const secondaryGrade3 = gradeByKey.get("Secondary::Grade 3")!;
  const groupDefs: {
    name: string;
    capacity: number;
    schedule: {
      day: "SATURDAY" | "SUNDAY" | "MONDAY" | "TUESDAY";
      start: number;
      end: number;
    };
  }[] = [
    {
      name: "G1",
      capacity: 30,
      schedule: { day: "SUNDAY", start: 16 * 60, end: 17 * 60 + 30 },
    },
    {
      name: "G2",
      capacity: 30,
      schedule: { day: "MONDAY", start: 16 * 60, end: 17 * 60 + 30 },
    },
    {
      name: "G3",
      capacity: 250,
      schedule: { day: "SATURDAY", start: 17 * 60, end: 19 * 60 },
    },
    {
      name: "G4",
      capacity: 30,
      schedule: { day: "TUESDAY", start: 16 * 60, end: 17 * 60 + 30 },
    },
  ];

  const groupByName = new Map<string, { id: string }>();
  for (const def of groupDefs) {
    const group = await db.group.create({
      data: {
        branchId: branch.id,
        gradeId: secondaryGrade3.id,
        subjectId: subject.id,
        teacherId: teacher.id,
        assistantId: def.name === "G3" ? assistant.id : undefined,
        name: def.name,
        capacity: def.capacity,
      },
    });
    groupByName.set(def.name, group);
    await db.schedule.create({
      data: {
        groupId: group.id,
        dayOfWeek: def.schedule.day,
        startMinutes: def.schedule.start,
        endMinutes: def.schedule.end,
      },
    });
  }
  const groupG3 = groupByName.get("G3")!;
  const groupG1 = groupByName.get("G1")!;

  // --- Demo students: three in G3, one in G1 (used to demo make-up
  // attendance — this student can scan at G3 and trigger the
  // "Student belongs to another group" confirmation flow). ---
  const demoStudentDefs = [
    { name: "Ahmed Mohamed", group: groupG3 },
    { name: "Sara Ali", group: groupG3 },
    { name: "Youssef Hassan", group: groupG3 },
    { name: "Mariam Adel", group: groupG1 },
  ];
  let parentPhoneCounter = 1;
  const students: { id: string; fullName: string; groupId: string }[] = [];
  for (const def of demoStudentDefs) {
    const studentCode = await generateStudentCode();
    const student = await db.student.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        studentCode,
        qrCode: buildQrPayload(studentCode),
        fullName: def.name,
        gender: "MALE",
        stageId: secondaryGrade3.stageId,
        gradeId: secondaryGrade3.id,
        groupId: def.group.id,
      },
    });
    students.push({
      id: student.id,
      fullName: student.fullName,
      groupId: def.group.id,
    });

    const parent = await db.parent.create({
      data: {
        fullName: `Parent of ${def.name}`,
        phone: `+2010000${String(1000 + parentPhoneCounter).slice(-4)}`,
        whatsappNumber: `+2010000${String(1000 + parentPhoneCounter).slice(-4)}`,
        preferredLanguage: "ar",
      },
    });
    parentPhoneCounter += 1;
    await db.studentParent.create({
      data: {
        studentId: student.id,
        parentId: parent.id,
        relationship: "Father",
        isPrimary: true,
      },
    });
  }
  const g3Students = students.filter((s) => s.groupId === groupG3.id);

  // ==========================================================
  // CLASS SESSIONS & ATTENDANCE (incl. one make-up example)
  // ==========================================================
  console.log("Seeding sessions and attendance...");

  const attendanceTypes: ("REGULAR" | "LATE" | "ABSENT")[] = [
    "REGULAR",
    "LATE",
    "ABSENT",
  ];
  const sessions: { id: string; date: Date }[] = [];
  for (let weekOffset = 3; weekOffset >= 0; weekOffset -= 1) {
    const sessionDate = new Date();
    sessionDate.setDate(sessionDate.getDate() - weekOffset * 7);
    sessionDate.setHours(0, 0, 0, 0);

    const session = await db.classSession.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        groupId: groupG3.id,
        teacherId: teacher.id,
        date: sessionDate,
        startMinutes: 17 * 60,
        endMinutes: 19 * 60,
        status: weekOffset === 0 ? "OPEN" : "COMPLETED",
      },
    });
    sessions.push({ id: session.id, date: sessionDate });

    for (const [index, student] of g3Students.entries()) {
      const type = attendanceTypes[index % attendanceTypes.length]!;
      await db.attendance.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          sessionId: session.id,
          studentId: student.id,
          groupId: groupG3.id,
          type,
        },
      });
    }

    // On the most recent (still-OPEN) session, demonstrate a make-up:
    // the G1 student scans in at G3 and an admin accepts it (spec §10).
    if (weekOffset === 0) {
      const makeUpStudent = students.find((s) => s.groupId === groupG1.id)!;
      await db.attendance.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          sessionId: session.id,
          studentId: makeUpStudent.id,
          groupId: groupG3.id,
          type: "MAKE_UP",
          makeUpReason:
            "Missed the regular G1 session this week — approved catch-up at G3.",
          originGroupId: groupG1.id,
        },
      });
    }
  }

  // ==========================================================
  // EXAMS, RECITATION, ASSIGNMENTS
  // ==========================================================
  console.log("Seeding exams, recitation and assignments...");

  const exam = await db.exam.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      subjectId: subject.id,
      groupId: groupG3.id,
      name: "Unit 1 Test",
      date: new Date(),
      maxScore: 20,
      durationMinutes: 45,
      isPublished: true,
      publishedAt: new Date(),
    },
  });
  const examScores = [18, 15, 9];
  for (const [index, student] of g3Students.entries()) {
    await db.examResult.create({
      data: {
        examId: exam.id,
        studentId: student.id,
        score: examScores[index % examScores.length]!,
      },
    });
  }

  for (const student of g3Students) {
    await db.recitation.create({
      data: {
        organizationId: org.id,
        studentId: student.id,
        groupId: groupG3.id,
        teacherId: teacher.id,
        date: new Date(),
        content: "Chapter 1, pages 1-10",
        score: 8,
        maxScore: 10,
        status: "COMPLETED",
      },
    });
  }

  const assignment = await db.assignment.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      groupId: groupG3.id,
      subjectId: subject.name,
      title: "Homework 1",
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxScore: 10,
    },
  });
  for (const [index, student] of g3Students.entries()) {
    await db.assignmentSubmission.create({
      data: {
        assignmentId: assignment.id,
        studentId: student.id,
        status: index === 0 ? "GRADED" : "PENDING",
        grade: index === 0 ? 9 : undefined,
      },
    });
  }

  // ==========================================================
  // SUBSCRIPTIONS, PAYMENTS, INVOICES (per-Stage fee, spec §17-20)
  // ==========================================================
  console.log("Seeding subscriptions, payments and invoices...");

  const now = new Date();
  const secondaryFee = 300;
  for (const [index, student] of students.entries()) {
    const subscription = await db.subscription.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        studentId: student.id,
        groupId: student.groupId,
        periodYear: now.getFullYear(),
        periodMonth: now.getMonth() + 1,
        amount: secondaryFee,
        dueDate: new Date(now.getFullYear(), now.getMonth(), 10),
        status: index % 2 === 0 ? "PAID" : "UNPAID",
      },
    });

    // Every other student has already paid — give them a receipt + invoice.
    if (index % 2 === 0) {
      const receiptNumber = `RCPT-DEMO-${String(index + 1).padStart(4, "0")}`;
      const payment = await db.payment.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          studentId: student.id,
          amount: secondaryFee,
          method: "CASH",
          receiptNumber,
        },
      });
      await db.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          subscriptionId: subscription.id,
          amount: secondaryFee,
        },
      });
      await db.subscription.update({
        where: { id: subscription.id },
        data: { paidAmount: secondaryFee, status: "PAID" },
      });
      await db.invoice.create({
        data: {
          organizationId: org.id,
          invoiceNumber: `INV-DEMO-${String(index + 1).padStart(4, "0")}`,
          paymentId: payment.id,
          studentId: student.id,
          totalAmount: secondaryFee,
          paidAmount: secondaryFee,
          remainingAmount: 0,
          description: `Tuition — ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
        },
      });
    }
  }

  // ==========================================================
  // EXPENSES & UTILITIES
  // ==========================================================
  console.log("Seeding expenses and utility bills...");

  await db.expense.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      category: "SUPPLIES",
      amount: 450,
      spentAt: new Date(),
      vendor: "Demo Stationery Store",
      method: "CASH",
    },
  });
  await db.expense.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      category: "MAINTENANCE",
      amount: 200,
      spentAt: new Date(),
      vendor: "Demo Maintenance Co.",
      method: "BANK_TRANSFER",
    },
  });

  await db.utilityBill.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      type: "ELECTRICITY",
      meterNumber: "EL-100234",
      periodStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      periodEnd: new Date(now.getFullYear(), now.getMonth(), 0),
      previousReading: 1000,
      currentReading: 1250,
      consumption: 250,
      amount: 375,
      dueDate: new Date(now.getFullYear(), now.getMonth(), 15),
      status: "UNPAID",
    },
  });

  const employee = await db.employee.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      fullName: "Demo Front Desk",
      phone: "+201000000010",
      position: "Receptionist",
      hireDate: new Date(now.getFullYear() - 1, 0, 1),
    },
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkIn = new Date(today);
  checkIn.setHours(9, 5, 0, 0);
  await db.employeeAttendance.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      employeeId: employee.id,
      date: today,
      checkInAt: checkIn,
      status: "LATE",
      lateMinutes: 5,
    },
  });

  // ==========================================================
  // NOTIFICATION TEMPLATES & RULES (spec §14, §30)
  // ==========================================================
  console.log("Seeding notification templates and rules...");

  for (const template of DEFAULT_TEMPLATES) {
    for (const locale of ["ar", "en"] as const) {
      await db.notificationTemplate.upsert({
        where: {
          organizationId_key_locale_channel: {
            organizationId: org.id,
            key: template.key,
            locale,
            channel: "WHATSAPP",
          },
        },
        update: {},
        create: {
          organizationId: org.id,
          key: template.key,
          locale,
          channel: "WHATSAPP",
          type: template.type,
          name: template.name,
          body: locale === "ar" ? template.ar : template.en,
        },
      });
    }
  }

  const defaultRules: {
    event:
      | "STUDENT_ABSENT"
      | "STUDENT_LATE"
      | "PAYMENT_OVERDUE"
      | "PAYMENT_RECEIVED"
      | "EXAM_PUBLISHED";
    templateKey: string;
  }[] = [
    { event: "STUDENT_ABSENT", templateKey: "attendance.absent" },
    { event: "STUDENT_LATE", templateKey: "attendance.late" },
    { event: "PAYMENT_OVERDUE", templateKey: "payment.reminder" },
    { event: "PAYMENT_RECEIVED", templateKey: "payment.received" },
    { event: "EXAM_PUBLISHED", templateKey: "exam.result" },
  ];
  for (const rule of defaultRules) {
    await db.notificationRule.upsert({
      where: {
        organizationId_event_channel: {
          organizationId: org.id,
          event: rule.event,
          channel: "WHATSAPP",
        },
      },
      update: {},
      create: {
        organizationId: org.id,
        event: rule.event,
        channel: "WHATSAPP",
        templateKey: rule.templateKey,
      },
    });
  }

  console.log("Seed complete.");
  console.log(
    "Academic hierarchy: Secondary -> Grade 3 -> G1, G2, G3 (250 cap), G4",
  );
  console.log("Demo login (all roles use the same password):");
  for (const u of demoUsers) console.log(`  ${u.email} / ${demoPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
