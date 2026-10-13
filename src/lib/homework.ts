import type { SubmissionStatus } from "@prisma/client";

/**
 * The homework page marks a student "Completed" or "Not completed", stored in
 * AssignmentSubmission.status. Rows written by the older (graded) assignments flow
 * keep working: SUBMITTED, LATE and GRADED all mean the work was handed in.
 */
export const COMPLETED_SUBMISSION_STATUSES: SubmissionStatus[] = ["SUBMITTED", "LATE", "GRADED"];

export type HomeworkState = "COMPLETED" | "NOT_COMPLETED" | "PENDING";

/** PENDING (or no row at all) means nobody has recorded it yet. */
export function homeworkState(status: SubmissionStatus | null | undefined): HomeworkState {
  if (!status || status === "PENDING") return "PENDING";
  return status === "MISSING" ? "NOT_COMPLETED" : "COMPLETED";
}
