"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { hasDictKey, useI18n } from "@/lib/i18n";
import { apiPost, currentMonth, formatDateTime, qs, useApi } from "@/lib/client";
import { fmt, formatLessonDate, formatTimeRange, localizeError, monthLabel, parseMonthInput, weekdayLabel } from "@/lib/lesson-format";
import { currentLesson, nextLesson } from "@/lib/lesson-flow";
import { Badge, ConfirmDialog, ErrorNotice, Field, PageHeader, useToast } from "@/components/ui";
import { GroupPicker } from "@/components/GroupPicker";
import { CameraScanner } from "@/components/CameraScanner";
import { StudentSnapshotCard, type StudentSnapshot } from "@/components/StudentSnapshotCard";

/**
 * Attendance scanner / lesson workspace (spec §8–§13, Stage 2).
 *
 * Flow: Month → Stage › Grade › Subject › Group → pick the lesson of that
 * month → OPEN it → scan / manually mark students (each scan shows the
 * student's info card) → CLOSE it explicitly. A lesson is never closed by the
 * clock. Lessons come from تشكيل الحصص; a USB/Bluetooth barcode gun works with
 * zero clicks since the code input stays focused.
 *
 * Cross-group scans (spec §10) never write silently: the API replies with
 * status "NEEDS_CONFIRMATION" and only "Accept make-up" resubmits the scan
 * with confirmMakeUp:true.
 */

interface LessonRow {
  id: string;
  lessonNumber: number | null;
  date: string;
  startMinutes: number;
  endMinutes: number;
  status: "SCHEDULED" | "OPEN" | "COMPLETED" | "CANCELLED";
  group: { id: string; name: string; capacity: number };
  _count: { attendances: number };
}

interface StudentCard {
  id: string;
  fullName: string;
  studentCode: string;
  photoUrl: string | null;
  currentGroup?: { id: string; name: string } | null;
}
interface SessionCard {
  id: string;
  lessonNumber: number | null;
  groupId: string;
  groupName: string;
  gradeName: string;
  stageName: string;
}

interface ScanResult {
  status: "ACCEPTED" | "REJECTED" | "NEEDS_CONFIRMATION";
  code: string;
  message: string;
  student?: StudentCard;
  session?: SessionCard;
  attendance?: { id: string; type: string; recordedAt: string };
  currentGroup?: { id: string; name: string } | null;
  selectedGroup?: { id: string; name: string };
  snapshot?: StudentSnapshot;
}

interface ManualStudent {
  id: string;
  fullName: string;
  studentCode: string;
  groupId: string;
  group: { name: string } | null;
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  if (status === "OPEN") return "brand" as const;
  return "neutral" as const;
}

export default function ScannerPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const errText = (err: unknown) => localizeError(err, t as (key: never) => string, hasDictKey);

  const [monthValue, setMonthValue] = useState(currentMonth());
  const ym = parseMonthInput(monthValue);
  const [groupId, setGroupId] = useState("");

  const lessons = useApi<{ sessions: LessonRow[] }>(
    groupId && ym ? `/api/sessions${qs({ groupId, year: ym.year, month: ym.month, pageSize: 100 })}` : null
  );
  const rows = lessons.data?.sessions ?? [];

  const [sessionId, setSessionId] = useState("");
  // Pick the lesson to work on: the open one, else the next one in order.
  useEffect(() => {
    if (!lessons.data) return;
    if (sessionId && rows.some((r) => r.id === sessionId)) return;
    const refs = rows.map((r) => ({ ...r, id: r.id, lessonNumber: r.lessonNumber, status: r.status }));
    const pick = currentLesson(refs) ?? nextLesson(refs) ?? rows[rows.length - 1] ?? null;
    setSessionId(pick?.id ?? "");
  }, [lessons.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = rows.find((r) => r.id === sessionId) ?? null;
  const isOpen = selected?.status === "OPEN";

  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  async function openSelected() {
    if (!selected) return;
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      await apiPost(`/api/sessions/${selected.id}/open`);
      toast.success(t("lesson.opened"));
      lessons.reload();
    } catch (err) {
      setLifecycleError(errText(err));
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function closeSelected() {
    if (!selected) return;
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      const result = await apiPost<{ absentMarked: number; nextLesson: { id: string; lessonNumber: number | null } | null }>(
        `/api/sessions/${selected.id}/close`
      );
      setConfirmClose(false);
      toast.success(
        `${fmt(t("lesson.closed"), { absent: result.absentMarked })} ${
          result.nextLesson?.lessonNumber ? fmt(t("lesson.nextIs"), { n: result.nextLesson.lessonNumber }) : t("lesson.noNext")
        }`
      );
      setResult(null);
      setHistory([]);
      setManualSelected(null);
      // Move on to the next lesson of the plan.
      setSessionId(result.nextLesson?.id ?? selected.id);
      lessons.reload();
    } catch (err) {
      setConfirmClose(false);
      setLifecycleError(errText(err));
    } finally {
      setLifecycleBusy(false);
    }
  }

  // -- Scan state --
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [makeUpReason, setMakeUpReason] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  // -- Manual attendance (spec §11): search by name/ID/phone/parent phone --
  const [mode, setMode] = useState<"SCAN" | "MANUAL">("SCAN");
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<ManualStudent[]>([]);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [manualSelected, setManualSelected] = useState<ManualStudent | null>(null);

  const snapshot = useApi<StudentSnapshot>(
    manualSelected && sessionId ? `/api/sessions/${sessionId}/student-snapshot${qs({ studentId: manualSelected.id })}` : null
  );

  useEffect(() => {
    const term = manualQuery.trim();
    if (term.length < 2) {
      setManualResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((body) => setManualResults(body.data?.students ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [manualQuery]);

  async function markManual(studentId: string, type: "REGULAR" | "LATE" | "MAKE_UP") {
    setManualBusy(true);
    setManualMessage(null);
    try {
      await apiPost("/api/attendance", { studentId, sessionId, type });
      setManualMessage(t("scanner.recorded"));
      snapshot.reload();
      lessons.reload();
    } catch (err) {
      setManualMessage(errText(err));
    } finally {
      setManualBusy(false);
    }
  }

  const refocus = useCallback(() => {
    if (!cameraOpen) inputRef.current?.focus();
  }, [cameraOpen]);
  useEffect(() => {
    if (!isOpen || mode !== "SCAN") setCameraOpen(false);
  }, [isOpen, mode]);
  useEffect(() => {
    if (isOpen && mode === "SCAN") refocus();
  }, [refocus, sessionId, isOpen, mode]);

  async function runScan(scanCode: string, confirmMakeUp: boolean) {
    setBusy(true);
    setScanError(null);
    try {
      const response = await apiPost<ScanResult>("/api/attendance/scan", {
        code: scanCode,
        sessionId,
        confirmMakeUp,
        makeUpReason: confirmMakeUp ? makeUpReason.trim() || undefined : undefined
      });
      setResult(response);
      if (response.status !== "NEEDS_CONFIRMATION") {
        setHistory((list) => [response, ...list].slice(0, 15));
        setPendingCode(null);
        setMakeUpReason("");
        if (response.status === "ACCEPTED") lessons.reload();
      } else {
        setPendingCode(scanCode);
      }
    } catch (err) {
      setScanError(errText(err));
      setResult(null);
      setPendingCode(null);
    } finally {
      setBusy(false);
      refocus();
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || !sessionId || busy || !isOpen) return;
    setCode("");
    await runScan(trimmed, false);
  }

  function rejectMakeUp() {
    setResult((r) => (r ? { ...r, status: "REJECTED", message: "Make-up attendance rejected." } : r));
    setHistory((list) => {
      const rejected: ScanResult = { ...(result as ScanResult), status: "REJECTED", message: "Rejected" };
      return [rejected, ...list].slice(0, 15);
    });
    setPendingCode(null);
    setMakeUpReason("");
    refocus();
  }

  async function acceptMakeUp() {
    if (!pendingCode) return;
    await runScan(pendingCode, true);
  }

  const accepted = result?.status === "ACCEPTED";
  const needsConfirmation = result?.status === "NEEDS_CONFIRMATION";
  const codeText = (c: string, fallback: string) => {
    const key = `scanner.code.${c}`;
    return hasDictKey(key) ? t(key as Parameters<typeof t>[0]) : fallback;
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("scanner.title")} description={t("scanner.subtitle")} />

      <div className="card space-y-3 p-4">
        <div className="max-w-xs">
          <Field label={t("lf.month")} required>
            {(id) => (
              <input
                id={id}
                type="month"
                className="input"
                value={monthValue}
                onChange={(e) => {
                  setMonthValue(e.target.value);
                  setSessionId("");
                }}
              />
            )}
          </Field>
        </div>
        <GroupPicker
          groupId={groupId}
          onChange={(id) => {
            setGroupId(id);
            setSessionId("");
            setResult(null);
            setHistory([]);
            setManualSelected(null);
          }}
        />
      </div>

      {groupId && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {/* ---- Lesson selection + lifecycle ---- */}
            <div className="card space-y-3 p-4">
              <ErrorNotice message={lessons.error} />
              {lessons.loading && !lessons.data && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}

              {lessons.data && rows.length === 0 && (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm text-black/60 dark:text-white/60">
                    {t("scanner.noPlan")} {ym && `(${monthLabel(ym.year, ym.month, locale)})`}
                  </p>
                  <Link href="/dashboard/academic/lesson-formation" className="btn-primary">
                    {t("scanner.goFormation")}
                  </Link>
                </div>
              )}

              {rows.length > 0 && (
                <>
                  <p className="text-sm font-medium">{t("scanner.lessons")}</p>
                  <div className="flex flex-wrap gap-2">
                    {rows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        aria-pressed={row.id === sessionId}
                        onClick={() => {
                          setSessionId(row.id);
                          setResult(null);
                          setManualSelected(null);
                        }}
                        className={`min-w-[8.5rem] rounded-lg border px-3 py-2 text-start text-sm transition ${
                          row.id === sessionId
                            ? "border-tecno-gold bg-tecno-gold/10"
                            : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold">
                            {row.lessonNumber !== null ? fmt(t("lesson.label"), { n: row.lessonNumber }) : t("lesson.legacy")}
                          </span>
                          <Badge tone={statusTone(row.status)}>{t(`lesson.status.${row.status}` as Parameters<typeof t>[0])}</Badge>
                        </span>
                        <span className="mt-0.5 block text-xs text-black/55 dark:text-white/55">
                          {weekdayLabel(row.date, locale)} {formatLessonDate(row.date)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {selected && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3 dark:border-white/10">
                  <p className="text-sm text-black/65 dark:text-white/65">
                    {formatTimeRange(selected.startMinutes, selected.endMinutes, locale)} · {selected._count.attendances} / {selected.group.capacity}
                  </p>
                  <div className="flex gap-2">
                    {selected.status === "SCHEDULED" && (
                      <button type="button" className="btn-primary" disabled={lifecycleBusy} onClick={openSelected}>
                        {lifecycleBusy ? t("common.loading") : t("lesson.open")}
                      </button>
                    )}
                    {selected.status === "OPEN" && (
                      <button type="button" className="btn-primary" disabled={lifecycleBusy} onClick={() => setConfirmClose(true)}>
                        {t("lesson.close")}
                      </button>
                    )}
                    <Link href={`/dashboard/academic/sessions/${selected.id}`} className="btn-secondary">
                      {t("lesson.report")}
                    </Link>
                  </div>
                </div>
              )}
              <ErrorNotice message={lifecycleError} />
              {selected?.status === "OPEN" && <p className="text-xs text-black/55 dark:text-white/55">{t("lesson.openHint")}</p>}
              {selected && selected.status === "SCHEDULED" && (
                <p className="text-sm text-black/60 dark:text-white/60">{t("scanner.openFirst")}</p>
              )}
            </div>

            {isOpen && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("SCAN")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${mode === "SCAN" ? "border-tecno-gold bg-tecno-gold/10" : "border-black/10 dark:border-white/10"}`}
                >
                  {t("scanner.title")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("MANUAL")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${mode === "MANUAL" ? "border-tecno-gold bg-tecno-gold/10" : "border-black/10 dark:border-white/10"}`}
                >
                  {t("scanner.manualAttendance")}
                </button>
              </div>
            )}

            {isOpen && mode === "SCAN" && (
              <form onSubmit={submit} className="card p-4">
                <Field label={t("scanner.placeholder")} required>
                  {(id) => (
                    <input
                      id={id}
                      ref={inputRef}
                      className="input py-4 text-center font-mono text-xl tracking-widest"
                      value={code}
                      autoComplete="off"
                      autoFocus
                      inputMode="text"
                      disabled={busy || needsConfirmation}
                      onChange={(e) => setCode(e.target.value)}
                      onBlur={() => {
                        if (!cameraOpen) setTimeout(refocus, 80);
                      }}
                      placeholder={t("scanner.placeholder")}
                    />
                  )}
                </Field>
                <button type="submit" className="btn-primary mt-4 w-full py-3 text-base" disabled={busy || needsConfirmation}>
                  {busy ? t("common.loading") : t("common.confirm")}
                </button>
                <button
                  type="button"
                  className="btn-secondary mt-3 w-full py-3 text-base"
                  onClick={() => setCameraOpen((v) => !v)}
                  disabled={needsConfirmation}
                >
                  📷 {cameraOpen ? t("scanner.camera.close") : t("scanner.camera.open")}
                </button>
                {cameraOpen && (
                  <CameraScanner
                    paused={busy || needsConfirmation}
                    onDetect={(c) => {
                      if (!sessionId || busy || !isOpen) return;
                      void runScan(c, false);
                    }}
                    onClose={() => setCameraOpen(false)}
                    labels={{
                      starting: t("scanner.camera.starting"),
                      denied: t("scanner.camera.denied"),
                      unsupported: t("scanner.camera.unsupported"),
                      noCamera: t("scanner.camera.noCamera"),
                      insecure: t("scanner.camera.insecure"),
                      hint: t("scanner.camera.hint"),
                      close: t("scanner.camera.close")
                    }}
                  />
                )}
              </form>
            )}

            {isOpen && mode === "MANUAL" && (
              <div className="space-y-3">
                <div className="card space-y-3 p-4">
                  <input
                    className="input"
                    placeholder="Search by name, ID, phone or parent phone"
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                  />
                  <ul className="divide-y divide-black/5 dark:divide-white/5">
                    {manualResults.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <div>
                          <p className="font-medium">{s.fullName}</p>
                          <p className="text-xs text-black/50 dark:text-white/50">
                            {s.studentCode} · {s.group?.name ?? "—"}
                            {s.groupId !== selected?.group.id && (
                              <span className="ms-1 text-amber-600 dark:text-amber-400">(different group)</span>
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-xs"
                          onClick={() => {
                            setManualSelected(s);
                            setManualMessage(null);
                          }}
                        >
                          {t("scanner.select")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {manualSelected && (
                  <div className="space-y-2">
                    {snapshot.data && <StudentSnapshotCard snapshot={snapshot.data} />}
                    <ErrorNotice message={snapshot.error} />
                    {manualMessage && <p className="text-sm text-black/60 dark:text-white/60">{manualMessage}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={manualBusy}
                        onClick={() => markManual(manualSelected.id, manualSelected.groupId === selected?.group.id ? "REGULAR" : "MAKE_UP")}
                      >
                        {t("lesson.present")}
                      </button>
                      <button type="button" className="btn-secondary" disabled={manualBusy} onClick={() => markManual(manualSelected.id, "LATE")}>
                        {t("lesson.late")}
                      </button>
                      {manualSelected.groupId !== selected?.group.id && (
                        <button type="button" className="btn-secondary" disabled={manualBusy} onClick={() => markManual(manualSelected.id, "MAKE_UP")}>
                          {t("scanner.makeup")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <ErrorNotice message={scanError} />

            {/* Spec §10: "Student belongs to another group" confirmation. */}
            {needsConfirmation && result && (
              <div className="card border-2 border-amber-500/60 p-5" role="alertdialog" aria-live="assertive">
                <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{t("scanner.differentGroup")}</p>
                <p className="mt-2">
                  {result.student?.fullName}{" "}
                  <span className="font-mono text-xs text-black/50 dark:text-white/50">{result.student?.studentCode}</span>
                </p>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-black/55 dark:text-white/55">{t("scanner.currentGroup")}</dt>
                    <dd className="font-medium">{result.currentGroup?.name ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-black/55 dark:text-white/55">{t("scanner.selectedGroup")}</dt>
                    <dd className="font-medium">{result.selectedGroup?.name ?? "—"}</dd>
                  </div>
                </dl>
                <input className="input mt-3" placeholder={t("common.reason")} value={makeUpReason} onChange={(e) => setMakeUpReason(e.target.value)} />
                <div className="mt-4 flex gap-2">
                  <button type="button" className="btn-primary flex-1" onClick={acceptMakeUp} disabled={busy}>
                    {t("scanner.acceptMakeup")}
                  </button>
                  <button type="button" className="btn-secondary flex-1" onClick={rejectMakeUp} disabled={busy}>
                    {t("scanner.reject")}
                  </button>
                </div>
              </div>
            )}

            {result && !needsConfirmation && (
              <div
                className={`card border-2 p-5 ${accepted ? "border-emerald-500/60" : "border-red-500/60"}`}
                role="status"
                aria-live="assertive"
              >
                <div className="flex items-center gap-4">
                  <span className={`text-4xl ${accepted ? "text-emerald-500" : "text-red-500"}`}>{accepted ? "✓" : "✕"}</span>
                  <div className="min-w-0">
                    <p className="text-lg font-bold">{accepted ? t("scanner.recorded") : codeText(result.code, result.message)}</p>
                    {result.student && (
                      <p className="truncate text-base">
                        {result.student.fullName}{" "}
                        <span className="font-mono text-xs text-black/50 dark:text-white/50">{result.student.studentCode}</span>
                      </p>
                    )}
                    {result.attendance && (
                      <p className="mt-1 flex items-center gap-2 text-sm">
                        <Badge tone={result.attendance.type === "LATE" ? "warning" : result.attendance.type === "MAKE_UP" ? "brand" : "success"}>
                          {t(`att.${result.attendance.type}` as Parameters<typeof t>[0])}
                        </Badge>
                        {formatDateTime(result.attendance.recordedAt)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Student info — immediately after every scan outcome. */}
            {result?.snapshot && <StudentSnapshotCard snapshot={result.snapshot} />}
          </div>

          <aside className="space-y-4">
            {selected && (
              <div className="card p-4">
                <h3 className="mb-2 font-semibold">{selected.group.name}</h3>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-black/55 dark:text-white/55">{t("lesson.number")}</dt>
                    <dd>{selected.lessonNumber ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-black/55 dark:text-white/55">{t("common.date")}</dt>
                    <dd>{formatLessonDate(selected.date)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-black/55 dark:text-white/55">{t("scanner.session")}</dt>
                    <dd>
                      {selected._count.attendances} / {selected.group.capacity}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-black/55 dark:text-white/55">{t("common.status")}</dt>
                    <dd>
                      <Badge tone={statusTone(selected.status)}>{t(`lesson.status.${selected.status}` as Parameters<typeof t>[0])}</Badge>
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="card p-4">
              <h3 className="mb-2 font-semibold">{t("scanner.recent")}</h3>
              {history.length === 0 ? (
                <p className="text-sm text-black/55 dark:text-white/55">—</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {history.map((entry, index) => (
                    <li key={`${entry.attendance?.id ?? entry.code}-${index}`} className="flex items-center gap-2">
                      <span className={entry.status === "ACCEPTED" ? "text-emerald-500" : "text-red-500"}>
                        {entry.status === "ACCEPTED" ? "✓" : "✕"}
                      </span>
                      <span className="truncate">{entry.student?.fullName ?? codeText(entry.code, entry.message)}</span>
                      {entry.attendance?.type && (
                        <Badge tone={entry.attendance.type === "LATE" ? "warning" : "neutral"}>
                          {t(`att.${entry.attendance.type}` as Parameters<typeof t>[0])}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}

      {!groupId && (
        <div className="card p-6 text-sm text-black/60 dark:text-white/60">{t("lf.pickGroup")}</div>
      )}

      <ConfirmDialog
        open={confirmClose}
        title={t("lesson.closeTitle")}
        message={t("lesson.closeMessage")}
        confirmLabel={t("lesson.close")}
        busy={lifecycleBusy}
        onCancel={() => setConfirmClose(false)}
        onConfirm={closeSelected}
      />
    </div>
  );
}
