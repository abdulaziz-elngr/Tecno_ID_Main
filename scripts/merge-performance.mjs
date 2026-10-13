#!/usr/bin/env node
/**
 * Merges the Stage-3 changes into the SHARED files of an existing TecnoID project
 * WITHOUT replacing them (so your own additions — e.g. the expenses pages and their
 * translations/permissions — are kept). Idempotent: safe to run twice.
 *
 *   node scripts/merge-performance.mjs [path-to-project]      (default: current folder)
 *
 * Patches: src/lib/i18n.tsx, src/components/Sidebar.tsx, src/lib/permissions.ts,
 *          package.json, prisma/schema.prisma
 * Every step prints OK / SKIP (already applied) / FAIL (anchor not found → do it by hand,
 * the expected edit is described in the message).
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
let failures = 0;

function edit(rel, steps) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.log(`FAIL  ${rel}: file not found`);
    failures++;
    return;
  }
  let text = fs.readFileSync(file, "utf8");
  for (const step of steps) {
    if (step.done(text)) {
      console.log(`SKIP  ${rel}: ${step.name}`);
      continue;
    }
    const next = step.apply(text);
    if (next === null || next === text) {
      console.log(`FAIL  ${rel}: ${step.name} — ${step.manual}`);
      failures++;
      continue;
    }
    text = next;
    console.log(`OK    ${rel}: ${step.name}`);
  }
  fs.writeFileSync(file, text);
}

const replaceOnce = (text, from, to) => (text.includes(from) ? text.replace(from, to) : null);

// ── i18n.tsx ────────────────────────────────────────────────────────────────
edit("src/lib/i18n.tsx", [
  {
    name: "import translations",
    manual: 'add: import { PERFORMANCE_AR, PERFORMANCE_EN } from "./i18n-performance"; at the top',
    done: (t) => t.includes("i18n-performance"),
    apply: (t) => {
      const m = t.match(/^import [^\n]*\n(?!import)/m);
      const lastImport = [...t.matchAll(/^import [^\n]*\n/gm)].pop();
      if (!lastImport) return null;
      const at = lastImport.index + lastImport[0].length;
      return t.slice(0, at) + 'import { PERFORMANCE_AR, PERFORMANCE_EN } from "./i18n-performance";\n' + t.slice(at);
    }
  },
  {
    name: "spread Arabic translations",
    manual: "add `...PERFORMANCE_AR,` as the first line inside  ar: {",
    done: (t) => t.includes("...PERFORMANCE_AR"),
    apply: (t) => replaceOnce(t, "  ar: {\n", "  ar: {\n    ...PERFORMANCE_AR,\n")
  },
  {
    name: "spread English translations",
    manual: "add `...PERFORMANCE_EN,` as the first line inside  en: {",
    done: (t) => t.includes("...PERFORMANCE_EN"),
    apply: (t) => replaceOnce(t, "  en: {\n", "  en: {\n    ...PERFORMANCE_EN,\n")
  }
]);

// ── Sidebar ─────────────────────────────────────────────────────────────────
edit("src/components/Sidebar.tsx", [
  {
    name: "Student performance link",
    manual: 'add { href: "/dashboard/performance/students", key: "nav.studentPerformance" } to the performance group',
    done: (t) => t.includes("/dashboard/performance/students"),
    apply: (t) => {
      const re = /(\{ href: "\/dashboard\/performance\/assignments", key: "nav\.assignments" \})(\s*\n)/;
      return re.test(t)
        ? t.replace(re, '$1,\n      { href: "/dashboard/performance/students", key: "nav.studentPerformance" }$2')
        : null;
    }
  }
]);

// ── permissions ─────────────────────────────────────────────────────────────
edit("src/lib/permissions.ts", [
  {
    name: "performance permission group",
    manual: 'add  performance: ["performance.view", "performance.recognize"],  to PERMISSIONS (before `communication:`)',
    done: (t) => t.includes('"performance.view"'),
    apply: (t) => replaceOnce(t, "  communication: [", '  performance: ["performance.view", "performance.recognize"],\n  communication: [')
  },
  {
    name: "MANAGER gets performance permissions",
    manual: "add `...PERMISSIONS.performance,` to the MANAGER role list",
    done: (t) => t.includes("...PERMISSIONS.performance"),
    apply: (t) => replaceOnce(t, "    ...PERMISSIONS.exams,\n", "    ...PERMISSIONS.exams,\n    ...PERMISSIONS.performance,\n")
  },
  {
    name: "TEACHER gets performance permissions",
    manual: 'add "performance.view", "performance.recognize" to the TEACHER role list',
    done: (t) => /"performance\.recognize",\s*\n\s*"reports\.view"/.test(t),
    apply: (t) => replaceOnce(t, '    "assignments.manage",\n    "reports.view"', '    "assignments.manage",\n    "performance.view",\n    "performance.recognize",\n    "reports.view"')
  }
]);

// ── package.json ────────────────────────────────────────────────────────────
edit("package.json", [
  {
    name: "@zxing camera-scanner dependencies",
    manual: 'add "@zxing/browser": "^0.1.5" and "@zxing/library": "^0.21.3" to dependencies',
    done: (t) => t.includes("@zxing/browser"),
    apply: (t) => {
      const pkg = JSON.parse(t);
      pkg.dependencies = { ...pkg.dependencies, "@zxing/browser": "^0.1.5", "@zxing/library": "^0.21.3" };
      pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
      return JSON.stringify(pkg, null, 2) + "\n";
    }
  }
]);

// ── prisma schema ───────────────────────────────────────────────────────────
const RECITATION_SESSION = `
/// Stage 3 — a recitation (تسميع) held for ONE group during ONE lesson
/// (ClassSession). It fixes the maximum score; each student's result is a
/// Recitation row pointing back here. One recitation per lesson.
model RecitationSession {
  id             String   @id @default(uuid())
  organizationId String
  branchId       String
  groupId        String
  sessionId      String
  title          String?
  date           DateTime @db.Date
  maxScore       Decimal  @default(10) @db.Decimal(5, 2)
  notes          String?
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  group   Group        @relation(fields: [groupId], references: [id])
  session ClassSession @relation(fields: [sessionId], references: [id])
  records Recitation[]

  @@unique([sessionId])
  @@index([organizationId])
  @@index([groupId])
  @@index([date])
}

/// Stage 3 — a teacher/admin recognising a student (Student performance page).
model StudentRecognition {
  id             String   @id @default(uuid())
  organizationId String
  branchId       String
  studentId      String
  reason         String
  recognizedAt   DateTime @db.Date
  notes          String?
  createdById    String?
  createdAt      DateTime @default(now())

  student Student @relation(fields: [studentId], references: [id])

  @@index([organizationId])
  @@index([studentId])
  @@index([recognizedAt])
}
`;

/** Inserts `line` just before the closing brace of `model <name> { ... }`. */
function addToModel(text, name, line) {
  const re = new RegExp(`(model ${name} \\{[\\s\\S]*?)(\\n\\})`);
  return re.test(text) ? text.replace(re, `$1\n${line}$2`) : null;
}

edit("prisma/schema.prisma", [
  {
    name: "RecitationSession + StudentRecognition models",
    manual: "append the two models from prisma/schema.prisma of the delivered project",
    done: (t) => t.includes("model RecitationSession"),
    apply: (t) => t.trimEnd() + "\n" + RECITATION_SESSION
  },
  {
    name: "Recitation.recitationSessionId",
    manual: "add to model Recitation: recitationSessionId String?, recitationSession RecitationSession? @relation(fields:[recitationSessionId], references:[id]), @@unique([recitationSessionId, studentId])",
    done: (t) => /model Recitation \{[^}]*recitationSessionId/.test(t),
    apply: (t) => {
      let n = addToModel(
        t,
        "Recitation",
        "  recitationSessionId String?\n  recitationSession   RecitationSession? @relation(fields: [recitationSessionId], references: [id])\n\n  @@unique([recitationSessionId, studentId])"
      );
      return n;
    }
  },
  {
    name: "Assignment.sessionId",
    manual: "add to model Assignment: sessionId String?, session ClassSession? @relation(fields:[sessionId], references:[id]), @@index([sessionId])",
    done: (t) => /model Assignment \{[^}]*\bsessionId\b/.test(t),
    apply: (t) =>
      addToModel(
        t,
        "Assignment",
        "  sessionId String?\n  session   ClassSession? @relation(fields: [sessionId], references: [id])\n\n  @@index([sessionId])"
      )
  },
  {
    name: "Group.recitationSessions back-relation",
    manual: "add to model Group: recitationSessions RecitationSession[]",
    done: (t) => /model Group \{[^}]*recitationSessions/.test(t),
    apply: (t) => addToModel(t, "Group", "  recitationSessions RecitationSession[]")
  },
  {
    name: "ClassSession back-relations",
    manual: "add to model ClassSession: recitationSession RecitationSession?, assignments Assignment[]",
    done: (t) => /model ClassSession \{[^}]*recitationSession/.test(t),
    apply: (t) => addToModel(t, "ClassSession", "  recitationSession RecitationSession?\n  assignments       Assignment[]")
  },
  {
    name: "Student.recognitions back-relation",
    manual: "add to model Student: recognitions StudentRecognition[]",
    done: (t) => /model Student \{[^}]*recognitions/.test(t),
    apply: (t) => addToModel(t, "Student", "  recognitions StudentRecognition[]")
  }
]);

console.log(
  failures === 0
    ? "\nDone. Now run: npm install && npx prisma generate && npx prisma format"
    : `\n${failures} step(s) need a manual edit (see FAIL lines above). Then run: npm install && npx prisma generate`
);
process.exit(failures === 0 ? 0 : 1);
