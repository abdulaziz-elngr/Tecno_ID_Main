"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/client";
import { Field } from "@/components/ui";

/**
 * Stage → Grade → Subject → Group cascade (the hierarchy introduced in
 * Stage 1). Reports the chosen group id upwards; when mounted with a groupId
 * (e.g. from a URL) it resolves the stage/grade/subject for that group.
 */

interface StageOption {
  id: string;
  name: string;
  isActive: boolean;
  grades: { id: string; name: string; isActive: boolean }[];
}

export interface PickerGroup {
  id: string;
  name: string;
  gradeId: string;
  capacity: number;
  currentCount: number;
  isActive: boolean;
  grade: { id: string; name: string; stage: { id: string; name: string } };
  subject: { id: string; name: string } | null;
  teacher: { id: string; fullName: string } | null;
  schedules: { id: string; dayOfWeek: string; startMinutes: number; endMinutes: number }[];
}

export function GroupPicker({
  groupId,
  onChange,
  includeInactive = false
}: {
  groupId: string;
  onChange: (groupId: string, group: PickerGroup | null) => void;
  includeInactive?: boolean;
}) {
  const { t } = useI18n();
  const { data: stages } = useApi<StageOption[]>("/api/stages");
  const { data: groups } = useApi<PickerGroup[]>("/api/groups");

  const [stageId, setStageId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const usable = useMemo(
    () => (groups ?? []).filter((g) => includeInactive || g.isActive),
    [groups, includeInactive]
  );

  // Resolve the cascade for a group given from outside (URL / restored state).
  useEffect(() => {
    if (!groupId || stageId) return;
    const g = usable.find((x) => x.id === groupId);
    if (g) {
      setStageId(g.grade.stage.id);
      setGradeId(g.grade.id);
      setSubjectId(g.subject?.id ?? "");
    }
  }, [groupId, usable, stageId]);

  const grades = stages?.find((s) => s.id === stageId)?.grades.filter((g) => includeInactive || g.isActive) ?? [];
  const groupsInGrade = usable.filter((g) => g.gradeId === gradeId);
  const subjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groupsInGrade) if (g.subject) map.set(g.subject.id, g.subject.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [groupsInGrade]);
  const groupOptions = groupsInGrade.filter((g) => !subjectId || g.subject?.id === subjectId);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              onChange("", null);
            }}
          >
            <option value="">{t("common.select")}</option>
            {(stages ?? [])
              .filter((s) => includeInactive || s.isActive)
              .map((s) => (
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
              onChange("", null);
            }}
          >
            <option value="">{t("common.select")}</option>
            {grades.map((g) => (
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
              onChange("", null);
            }}
          >
            <option value="">{t("common.all")}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("lf.group")} required>
        {(id) => (
          <select
            id={id}
            className="input"
            value={groupId}
            disabled={!gradeId}
            onChange={(e) => onChange(e.target.value, usable.find((g) => g.id === e.target.value) ?? null)}
          >
            <option value="">{t("common.select")}</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.subject ? `${g.subject.name} · ` : ""}
                {g.name}
                {!g.isActive ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}
