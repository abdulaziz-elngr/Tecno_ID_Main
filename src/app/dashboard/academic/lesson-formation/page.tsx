"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { hasDictKey, useI18n } from "@/lib/i18n";
import { apiDelete, apiPost, currentMonth, qs, useApi } from "@/lib/client";
import {
  dayName,
  fmt,
  formatLessonDate,
  formatTimeRange,
  localizeError,
  monthLabel,
  parseMonthInput,
  weekdayLabel
} from "@/lib/lesson-format";
import { Badge, ConfirmDialog, DataTable, ErrorNotice, Field, PageHeader, useToast } from "@/components/ui";

/**
 * تشكيل الحصص — Lesson formation (Stage 2).
 *
 * Month + Stage → Grade → Subject → Group + lessons per week → the server
 * computes the REAL calendar dates from the group's weekly schedule → the
 * administrator reviews (and can untick) them → confirm creates the numbered
 * lessons of that month.
 */

interface StageOption {
  id: string;
  name: string;
  isActive: boolean;
  grades: { id: string; name: string; isActive: boolean }[];
}

interface GroupOption {
  id: string;
  name: string;
  gradeId: string;
  isActive: boolean;
  grade: { id: string; name: string; stage: { id: string; name: string } };
  subject: { id: string; name: string } | null;
  teacher: { id: string; fullName: string } | null;
  schedules: { id: string; dayOfWeek: string; startMinutes: number; endMinutes: number }[];
}

interface PreviewLesson {
  lessonNumber: number;
  date: string;
  dayOfWeek: string;
  startMinutes: number;
  endMinutes: number;
  adoptsSessionId: string | null;
  adoptsStatus: string | null;
  adoptsAttendanceCount: number;
}

interface Preview {
  appliedLessonsPerWeek: number;
  weeksInMonth: number;
  warnings: ({ code: "NO_SCHEDULE" } | { code: "LESSONS_PER_WEEK_CAPPED"; requested: number; applied: number })[];
  existingPlan: { id: string; lessonCount: number } | null;
  lessons: PreviewLesson[];
}

interface PlanRow {
  id: string;
  year: number;
  month: number;
  lessonsPerWeek: number;
  group: {
    id: string;
    name: string;
    grade: { name: string; stage: { name: string } };
    subject: { name: string } | null;
    teacher: { fullName: string } | null;
  };
  progress: { total: number; completed: number; open: number };
  deletable: boolean;
}

const slotKey = (l: { date: string; startMinutes: number }) => `${l.date}|${l.startMinutes}`;

export default function LessonFormationPage() {
  const { t, locale } = useI18n();
  const toast = useToast();

  const [monthValue, setMonthValue] = useState(currentMonth());
  const ym = parseMonthInput(monthValue);

  const { data: stages } = useApi<StageOption[]>("/api/stages");
  const { data: groups } = useApi<GroupOption[]>("/api/groups");

  const [stageId, setStageId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [perWeek, setPerWeek] = useState(1);

  const gradesForStage = stages?.find((s) => s.id === stageId)?.grades.filter((g) => g.isActive) ?? [];
  const activeGroups = useMemo(() => (groups ?? []).filter((g) => g.isActive), [groups]);
  const groupsForGrade = useMemo(() => activeGroups.filter((g) => g.gradeId === gradeId), [activeGroups, gradeId]);
  const subjectsForGrade = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groupsForGrade) if (g.subject) map.set(g.subject.id, g.subject.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [groupsForGrade]);
  const groupsForSubject = useMemo(
    () => groupsForGrade.filter((g) => !subjectId || g.subject?.id === subjectId),
    [groupsForGrade, subjectId]
  );
  const group = activeGroups.find((g) => g.id === groupId) ?? null;
  const slotCount = group?.schedules.length ?? 0;

  // Keep lessons/week within what the group's schedule allows.
  useEffect(() => {
    if (slotCount > 0 && perWeek > slotCount) setPerWeek(slotCount);
  }, [slotCount, perWeek]);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Any change of inputs invalidates a previous preview.
  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [groupId, monthValue, perWeek]);

  const groupReady = !!group && !!group.subject && !!group.teacher && group.schedules.length > 0;

  async function runPreview() {
    if (!group || !ym) return;
    setPreviewing(true);
    setError(null);
    try {
      const result = await apiPost<Preview>("/api/lesson-plans/preview", {
        groupId: group.id,
        year: ym.year,
        month: ym.month,
        lessonsPerWeek: perWeek
      });
      setPreview(result);
      setPicked(new Set(result.lessons.map(slotKey)));
    } catch (err) {
      setPreview(null);
      setError(errorText(err));
    } finally {
      setPreviewing(false);
    }
  }

  function errorText(err: unknown): string {
    return localizeError(err, t as (key: never) => string, hasDictKey);
  }

  const chosen = preview ? preview.lessons.filter((l) => picked.has(slotKey(l))) : [];

  const plans = useApi<PlanRow[]>(
    ym ? `/api/lesson-plans${qs({ year: ym.year, month: ym.month, stageId, gradeId, subjectId })}` : null
  );
  const [toDelete, setToDelete] = useState<PlanRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmPlan() {
    if (!group || !ym || !preview) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ planId: string; total: number }>("/api/lesson-plans", {
        groupId: group.id,
        year: ym.year,
        month: ym.month,
        lessonsPerWeek: perWeek,
        lessons: chosen.map((l) => ({ date: l.date, startMinutes: l.startMinutes }))
      });
      toast.success(fmt(t("lf.created"), { count: result.total }));
      setPreview(null);
      plans.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function removePlan() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/lesson-plans/${toDelete.id}`);
      toast.success(t("common.saved"));
      setToDelete(null);
      plans.reload();
      setPreview(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("lf.title")} description={t("lf.subtitle")} />

      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("lf.month")} required>
          {(id) => (
            <input id={id} type="month" className="input" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} />
          )}
        </Field>
        <Field label={t("nav.stages")} required>
          {(id) => (
            <select
              id={id}
              className="input"
              value={stageId}
              onChange={(e) => {
                setStageId(e.target.value);
                setGradeId("");
                setSubjectId("");
                setGroupId("");
              }}
            >
              <option value="">{t("common.select")}</option>
              {(stages ?? []).filter((s) => s.isActive).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("grades.title")} required>
          {(id) => (
            <select
              id={id}
              className="input"
              value={gradeId}
              disabled={!stageId}
              onChange={(e) => {
                setGradeId(e.target.value);
                setSubjectId("");
                setGroupId("");
              }}
            >
              <option value="">{t("common.select")}</option>
              {gradesForStage.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("lf.subject")}>
          {(id) => (
            <select
              id={id}
              className="input"
              value={subjectId}
              disabled={!gradeId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setGroupId("");
              }}
            >
              <option value="">{t("common.all")}</option>
              {subjectsForGrade.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("lf.group")} required>
          {(id) => (
            <select id={id} className="input" value={groupId} disabled={!gradeId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{t("common.select")}</option>
              {groupsForSubject.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.subject ? `${g.subject.name} · ` : ""}
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("lf.lessonsPerWeek")} hint={t("lf.lessonsPerWeekHint")} required>
          {(id) => (
            <input
              id={id}
              type="number"
              className="input"
              min={1}
              max={Math.max(1, slotCount || 14)}
              value={perWeek}
              onChange={(e) => setPerWeek(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          )}
        </Field>
      </div>

      {!group && <p className="text-sm text-black/55 dark:text-white/55">{t("lf.pickGroup")}</p>}

      {group && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">
              {group.grade.stage.name} › {group.grade.name} › {group.subject?.name ?? "—"} › {group.name}
            </span>
            <span className="text-black/55 dark:text-white/55">· {group.teacher?.fullName ?? "—"}</span>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">{t("lf.groupSchedule")}</p>
            {group.schedules.length === 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">{t("lf.noSchedule")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {group.schedules.map((s) => (
                  <Badge key={s.id} tone="brand">
                    {dayName(s.dayOfWeek, locale)} · {formatTimeRange(s.startMinutes, s.endMinutes, locale)}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {!groupReady && group.schedules.length > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-300">{t("lf.groupIncomplete")}</p>
          )}

          <ErrorNotice message={error} />

          <button type="button" className="btn-primary" disabled={!groupReady || !ym || previewing} onClick={runPreview}>
            {previewing ? t("common.loading") : t("lf.preview")}
          </button>
        </div>
      )}

      {preview && ym && group && (
        <div className="card space-y-3 p-4">
          <div>
            <h2 className="text-lg font-semibold">
              {t("lf.reviewTitle")} — {monthLabel(ym.year, ym.month, locale)}
            </h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              {fmt(t("lf.summary"), { count: chosen.length, weeks: preview.weeksInMonth })} · {t("lf.reviewHint")}
            </p>
          </div>

          {preview.warnings.map((w) =>
            w.code === "LESSONS_PER_WEEK_CAPPED" ? (
              <p key={w.code} className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                {fmt(t("lf.capped"), { applied: w.applied, requested: w.requested })}
              </p>
            ) : null
          )}

          {preview.existingPlan && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{t("lf.planExists")}</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
                <tr>
                  <th className="w-10 p-3" />
                  <th className="p-3 text-start">{t("lesson.number")}</th>
                  <th className="p-3 text-start">{t("lesson.day")}</th>
                  <th className="p-3 text-start">{t("common.date")}</th>
                  <th className="p-3 text-start">{t("lesson.time")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.lessons.map((lesson) => {
                  const key = slotKey(lesson);
                  const isPicked = picked.has(key);
                  // Numbers follow the chosen lessons, so unticking renumbers the rest.
                  const number = isPicked ? chosen.findIndex((l) => slotKey(l) === key) + 1 : null;
                  return (
                    <tr key={key} className={`border-b border-black/5 dark:border-white/5 ${isPicked ? "" : "opacity-45"}`}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={isPicked}
                          aria-label={formatLessonDate(lesson.date)}
                          onChange={() =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="p-3 font-semibold">{number ?? "—"}</td>
                      <td className="p-3">{weekdayLabel(lesson.date, locale)}</td>
                      <td className="p-3">{formatLessonDate(lesson.date)}</td>
                      <td className="p-3">
                        {formatTimeRange(lesson.startMinutes, lesson.endMinutes, locale)}
                        {lesson.adoptsSessionId && (
                          <span className="ms-2 text-xs text-amber-700 dark:text-amber-300">{t("lf.adopts")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || chosen.length === 0 || !!preview.existingPlan}
              onClick={confirmPlan}
            >
              {saving ? t("common.loading") : t("lf.confirm")}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">
          {t("lf.plansTitle")}
          {ym && <span className="ms-2 text-sm font-normal text-black/55 dark:text-white/55">{monthLabel(ym.year, ym.month, locale)}</span>}
        </h2>
        <ErrorNotice message={plans.error} />
        <DataTable
          columns={[t("nav.stages"), t("grades.title"), t("lf.subject"), t("lf.group"), t("common.teacher"), t("lf.lessonsPerWeek"), t("common.status"), t("common.actions")]}
          loading={plans.loading}
          isEmpty={(plans.data?.length ?? 0) === 0}
          emptyTitle={t("lf.plansEmpty")}
        >
          {plans.data?.map((plan) => (
            <tr key={plan.id} className="border-b border-black/5 dark:border-white/5">
              <td className="p-3">{plan.group.grade.stage.name}</td>
              <td className="p-3">{plan.group.grade.name}</td>
              <td className="p-3">{plan.group.subject?.name ?? "—"}</td>
              <td className="p-3 font-medium">{plan.group.name}</td>
              <td className="p-3">{plan.group.teacher?.fullName ?? "—"}</td>
              <td className="p-3">{plan.lessonsPerWeek}</td>
              <td className="p-3">
                <Badge tone={plan.progress.completed === plan.progress.total ? "success" : plan.progress.open > 0 ? "brand" : "neutral"}>
                  {fmt(t("lf.progress"), { done: plan.progress.completed, total: plan.progress.total })}
                </Badge>
              </td>
              <td className="space-x-3 p-3 rtl:space-x-reverse">
                <Link
                  href={`/dashboard/academic/sessions?${qs({ year: plan.year, month: plan.month, groupId: plan.group.id }).slice(1)}`}
                  className="text-tecno-gold-dark hover:underline dark:text-tecno-gold"
                >
                  {t("lf.openLessons")}
                </Link>
                {plan.deletable ? (
                  <button type="button" className="text-red-600 hover:underline dark:text-red-400" onClick={() => setToDelete(plan)}>
                    {t("lf.deletePlan")}
                  </button>
                ) : (
                  <span className="text-xs text-black/40 dark:text-white/40" title={t("lf.deleteLocked")}>
                    🔒
                  </span>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title={t("lf.deletePlan")}
        message={t("lf.deleteConfirm")}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={removePlan}
      />
    </div>
  );
}
