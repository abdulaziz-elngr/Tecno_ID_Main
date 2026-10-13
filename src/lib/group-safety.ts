import type { Prisma } from "@prisma/client";
import { db } from "./db";
import type { GroupDependencyCounts } from "./group-rules";

export {
  describeGroupBlockers,
  evaluateGroupDeletion,
  normalizeSubjectCode,
  type GroupDeletionVerdict,
  type GroupDependencyCounts,
  type GroupDependencyKey
} from "./group-rules";

/**
 * Group deletion safety (Stage 1) — database side. The decision logic is in
 * ./group-rules; this module only gathers the counts it needs.
 */

type Client = Prisma.TransactionClient | typeof db;

/** Counts every record that depends on the group. */
export async function countGroupDependencies(
  groupId: string,
  client: Client = db
): Promise<GroupDependencyCounts> {
  const [students, sessions, attendance, exams, assignments, subscriptions] = await Promise.all([
    client.student.count({ where: { groupId, deletedAt: null } }),
    client.classSession.count({ where: { groupId } }),
    client.attendance.count({ where: { groupId } }),
    client.exam.count({ where: { groupId, deletedAt: null } }),
    client.assignment.count({ where: { groupId, deletedAt: null } }),
    client.subscription.count({ where: { groupId } })
  ]);
  return { students, sessions, attendance, exams, assignments, subscriptions };
}
