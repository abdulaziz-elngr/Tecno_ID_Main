"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { LessonReportView } from "@/components/LessonReportView";

/** A single lesson record (deep link from student profiles, the scanner and the Lessons list). */
export default function LessonDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  return (
    <div className="space-y-4">
      <Link href="/dashboard/academic/sessions" className="no-print inline-block text-sm text-tecno-gold-dark hover:underline dark:text-tecno-gold">
        ← {t("sessions.title")}
      </Link>
      <LessonReportView sessionId={params.id} />
    </div>
  );
}
