import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { findScheduleConflicts, isValidTimeRange } from "@/lib/scheduling";
import { timeStringToMinutes, minutesToTimeString } from "@/lib/time";

const DAY_ENUM = z.enum([
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY"
]);

const listQuerySchema = z.object({
  groupId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  dayOfWeek: DAY_ENUM.optional()
});

const timeString = z.string().refine((v) => timeStringToMinutes(v) !== null, {
  message: "Time must be in HH:MM 24-hour format."
});

const createScheduleSchema = z
  .object({
    groupId: z.string().uuid(),
    dayOfWeek: DAY_ENUM,
    startTime: timeString,
    endTime: timeString
  })
  .refine(
    (data) => {
      const start = timeStringToMinutes(data.startTime)!;
      const end = timeStringToMinutes(data.endTime)!;
      return isValidTimeRange(start, end);
    },
    { message: "startTime must be before endTime.", path: ["endTime"] }
  );

function handleKnownErrors(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error("[schedules] internal error", err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

function serializeSchedule(s: {
  id: string;
  groupId: string;
  dayOfWeek: string;
  startMinutes: number;
  endMinutes: number;
  isActive: boolean;
}) {
  return {
    ...s,
    startTime: minutesToTimeString(s.startMinutes),
    endTime: minutesToTimeString(s.endMinutes)
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.schedule.manage");
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
    }
    const branchIds = resolveBranchScope(ctx, parsed.data.branchId);

    const schedules = await db.schedule.findMany({
      where: {
        isActive: true,
        ...(parsed.data.groupId ? { groupId: parsed.data.groupId } : {}),
        ...(parsed.data.dayOfWeek ? { dayOfWeek: parsed.data.dayOfWeek } : {}),
        group: {
          deletedAt: null,
          branch: { center: { organizationId: ctx.organizationId } },
          ...(branchIds ? { branchId: { in: branchIds } } : {})
        }
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            teacher: { select: { id: true, fullName: true } },
            assistant: { select: { id: true, fullName: true } }
          }
        }
      },
      orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }]
    });

    return NextResponse.json({ data: schedules.map(serializeSchedule) });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.schedule.manage");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const parsed = createScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid schedule data.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;
    const startMinutes = timeStringToMinutes(input.startTime)!;
    const endMinutes = timeStringToMinutes(input.endTime)!;

    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const group = await db.group.findFirst({
      where: {
        id: input.groupId,
        deletedAt: null,
        branch: { center: { organizationId: ctx.organizationId } },
        ...(branchIds ? { branchId: { in: branchIds } } : {})
      }
    });
    if (!group) {
      return NextResponse.json({ error: "Invalid group." }, { status: 400 });
    }

    // Spec §4: prevent teacher/group scheduling conflicts (no rooms).
    const conflicts = await findScheduleConflicts({
      groupId: input.groupId,
      teacherId: group.teacherId,
      assistantId: group.assistantId,
      dayOfWeek: input.dayOfWeek,
      startMinutes,
      endMinutes
    });

    if (conflicts.length > 0) {
      return NextResponse.json(
        {
          error: "This time slot conflicts with an existing schedule.",
          conflicts: conflicts.map((c) => ({
            type: c.type,
            conflictingGroup: c.groupName
          }))
        },
        { status: 409 }
      );
    }

    const schedule = await db.schedule.create({
      data: {
        groupId: input.groupId,
        dayOfWeek: input.dayOfWeek,
        startMinutes,
        endMinutes
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_SCHEDULE",
      entityType: "Schedule",
      entityId: schedule.id,
      afterValue: schedule
    });

    return NextResponse.json({ data: serializeSchedule(schedule) }, { status: 201 });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
