"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPut, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface TemplateRow {
  id: string;
  key: string;
  locale: string;
  channel: string;
  type: string;
  name: string;
  subject: string | null;
  body: string;
  providerTemplateName: string | null;
  isActive: boolean;
  placeholders: string[];
}

const CHANNELS = ["IN_APP", "WHATSAPP", "EMAIL"];
const TYPES = ["ATTENDANCE", "PAYMENT", "EXAM", "ACADEMIC", "ADMINISTRATIVE", "SYSTEM"];
const LOCALES = ["ar", "en"];

export default function TemplatesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<TemplateRow[]>("/api/whatsapp/templates");

  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    key: "",
    locale: "en",
    channel: "IN_APP",
    type: "SYSTEM",
    name: "",
    subject: "",
    body: "",
    providerTemplateName: "",
    isActive: true
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openEdit(template: TemplateRow) {
    setEditing(template);
    setForm({
      key: template.key,
      locale: template.locale,
      channel: template.channel,
      type: template.type,
      name: template.name,
      subject: template.subject ?? "",
      body: template.body,
      providerTemplateName: template.providerTemplateName ?? "",
      isActive: template.isActive
    });
    setFormError(null);
    setModalOpen(true);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      key: "",
      locale: "en",
      channel: "IN_APP",
      type: "SYSTEM",
      name: "",
      subject: "",
      body: "",
      providerTemplateName: "",
      isActive: true
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPut("/api/whatsapp/templates", {
        key: form.key.trim(),
        locale: form.locale,
        channel: form.channel,
        type: form.type,
        name: form.name.trim(),
        subject: form.subject.trim() || undefined,
        body: form.body.trim(),
        providerTemplateName: form.providerTemplateName.trim() || undefined,
        isActive: form.isActive
      });
      toast.success(t("common.saved"));
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save template.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("templates.title")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            {t("common.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <DataTable
        columns={["Key", "Locale", "Channel", "Type", "Name", t("common.status"), t("common.actions")]}
        loading={loading}
        isEmpty={(data?.length ?? 0) === 0}
        emptyTitle={t("templates.empty")}
      >
        {data?.map((tpl) => (
          <tr key={tpl.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-mono text-xs">{tpl.key}</td>
            <td className="p-3">{tpl.locale}</td>
            <td className="p-3">{tpl.channel}</td>
            <td className="p-3">{tpl.type}</td>
            <td className="p-3">{tpl.name}</td>
            <td className="p-3">
              <Badge tone={tpl.isActive ? "success" : "neutral"}>{tpl.isActive ? "Active" : "Inactive"}</Badge>
            </td>
            <td className="p-3">
              <button type="button" className="text-xs hover:underline" onClick={() => openEdit(tpl)}>
                {t("common.edit")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal open={modalOpen} title={editing ? t("common.edit") : t("common.add")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label="Key" required hint="Stable identifier used by the notification system">
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.key}
                disabled={Boolean(editing)}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                required
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Locale" required>
              {(id) => (
                <select id={id} className="input" value={form.locale} disabled={Boolean(editing)} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Channel" required>
              {(id) => (
                <select id={id} className="input" value={form.channel} disabled={Boolean(editing)} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Type" required>
              {(id) => (
                <select id={id} className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  {TYPES.map((tp) => (
                    <option key={tp} value={tp}>
                      {tp}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="Name" required>
            {(id) => <input id={id} className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />}
          </Field>
          {form.channel === "EMAIL" && (
            <Field label="Subject">
              {(id) => <input id={id} className="input" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />}
            </Field>
          )}
          <Field label="Body" required hint="Use {{placeholders}} for dynamic values, e.g. {{student_name}}">
            {(id) => (
              <textarea id={id} className="input min-h-[100px]" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} required />
            )}
          </Field>
          {form.channel === "WHATSAPP" && (
            <Field label="Provider template name" hint="Meta-approved template name, if different from Key">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={form.providerTemplateName}
                  onChange={(e) => setForm((f) => ({ ...f, providerTemplateName: e.target.value }))}
                />
              )}
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="h-4 w-4"
            />
            Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !form.key.trim() || !form.name.trim() || !form.body.trim()}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
