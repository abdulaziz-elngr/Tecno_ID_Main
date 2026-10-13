/**
 * Pure aggregation helpers for the Subjects pages (Stage 1).
 *
 *   Subject -> Teacher -> Groups -> Students
 *
 * Kept free of database imports so it can be unit tested directly. The API
 * routes load the rows with Prisma and hand them to these functions.
 */

export interface SummaryGroup {
  id: string;
  name: string;
  capacity: number;
  isActive: boolean;
  studentCount: number;
  grade: { id: string; name: string; order?: number; stage: { id: string; name: string; order?: number } };
  teacher: { id: string; fullName: string } | null;
}

export interface SummaryTeacher {
  id: string;
  fullName: string;
}

export interface SubjectTeacherEntry extends SummaryTeacher {
  /** Declared via TeacherSubject (qualified for the subject). */
  declared: boolean;
  /** Currently responsible for at least one group of this subject. */
  groupIds: string[];
}

/**
 * Teachers of a subject = teachers explicitly declared for it UNION teachers
 * who are responsible for one of its groups. A teacher is never duplicated.
 */
export function mergeSubjectTeachers(
  declared: readonly SummaryTeacher[],
  groups: readonly Pick<SummaryGroup, "id" | "teacher">[]
): SubjectTeacherEntry[] {
  const byId = new Map<string, SubjectTeacherEntry>();
  for (const t of declared) {
    byId.set(t.id, { id: t.id, fullName: t.fullName, declared: true, groupIds: [] });
  }
  for (const g of groups) {
    if (!g.teacher) continue;
    const entry = byId.get(g.teacher.id) ?? {
      id: g.teacher.id,
      fullName: g.teacher.fullName,
      declared: false,
      groupIds: []
    };
    entry.groupIds.push(g.id);
    byId.set(g.teacher.id, entry);
  }
  return Array.from(byId.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export interface SubjectTotals {
  groups: number;
  activeGroups: number;
  students: number;
  capacity: number;
  stages: { id: string; name: string }[];
  grades: { id: string; name: string; stageName: string }[];
}

/** Totals + the distinct stages/grades the subject is taught in. */
export function summarizeSubjectGroups(groups: readonly SummaryGroup[]): SubjectTotals {
  const stages = new Map<string, { id: string; name: string; order: number }>();
  const grades = new Map<string, { id: string; name: string; stageName: string; order: number; stageOrder: number }>();
  let students = 0;
  let capacity = 0;
  let activeGroups = 0;

  for (const g of groups) {
    students += g.studentCount;
    capacity += g.capacity;
    if (g.isActive) activeGroups += 1;
    stages.set(g.grade.stage.id, {
      id: g.grade.stage.id,
      name: g.grade.stage.name,
      order: g.grade.stage.order ?? 0
    });
    grades.set(g.grade.id, {
      id: g.grade.id,
      name: g.grade.name,
      stageName: g.grade.stage.name,
      order: g.grade.order ?? 0,
      stageOrder: g.grade.stage.order ?? 0
    });
  }

  return {
    groups: groups.length,
    activeGroups,
    students,
    capacity,
    stages: Array.from(stages.values())
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map(({ id, name }) => ({ id, name })),
    grades: Array.from(grades.values())
      .sort((a, b) => a.stageOrder - b.stageOrder || a.order - b.order || a.name.localeCompare(b.name))
      .map(({ id, name, stageName }) => ({ id, name, stageName }))
  };
}
