import type { Prisma } from "@prisma/client";
import { db } from "./db";

type Client = Prisma.TransactionClient | typeof db;

/**
 * Records that a teacher teaches a subject, reusing the existing Teacher row
 * (never creating a new one). Idempotent: linking twice is a no-op. Called
 * whenever a group is saved with both a subject and a teacher so the
 * Subject -> Teacher relationship can never drift from Group.teacherId.
 */
export async function linkTeacherToSubject(
  client: Client,
  teacherId: string,
  subjectId: string
): Promise<void> {
  await client.teacherSubject.upsert({
    where: { teacherId_subjectId: { teacherId, subjectId } },
    create: { teacherId, subjectId },
    update: {}
  });
}

/**
 * After a TEACHER (not an assistant) is given groups from the Teachers page,
 * record that they teach the subject of each of those groups. Groups with no
 * subject (legacy rows) are skipped. Idempotent.
 */
export async function linkTeacherToSubjectsOfGroups(
  client: Client,
  teacherId: string,
  groupIds: readonly string[]
): Promise<void> {
  if (groupIds.length === 0) return;
  const rows = await client.group.findMany({
    where: { id: { in: [...groupIds] }, deletedAt: null, subjectId: { not: null } },
    select: { subjectId: true }
  });
  const subjectIds = Array.from(new Set(rows.map((r) => r.subjectId).filter((id): id is string => id !== null)));
  for (const subjectId of subjectIds) {
    await linkTeacherToSubject(client, teacherId, subjectId);
  }
}
