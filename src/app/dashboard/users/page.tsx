"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, formatDateTime, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, DataTable, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface BranchOption {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  userRoles: { role: { id: string; name: string } }[];
  userBranches: { branch: { id: string; name: string } }[];
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissionKeys: string[];
}

interface PermissionCatalog {
  modules: Record<string, { key: string; module: string }[]>;
}

interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export default function UsersPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<"users" | "roles" | "sessions">("users");

  // ---- Users tab ----
  const { data: usersData, loading: usersLoading, error: usersError, reload: reloadUsers } = useApi<UserRow[]>(
    tab === "users" ? "/api/users?pageSize=100" : null,
    [tab]
  );
  const { data: roles } = useApi<RoleRow[]>("/api/roles");
  const { data: branches } = useApi<BranchOption[]>("/api/branches");

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [uFullName, setUFullName] = useState("");
  const [uEmail, setUEmail] = useState("");
  const [uPhone, setUPhone] = useState("");
  const [uPassword, setUPassword] = useState("");
  const [uRoleIds, setURoleIds] = useState<string[]>([]);
  const [uBranchIds, setUBranchIds] = useState<string[]>([]);
  const [uIsActive, setUIsActive] = useState(true);
  const [uReason, setUReason] = useState("");
  const [uSubmitting, setUSubmitting] = useState(false);
  const [uError, setUError] = useState<string | null>(null);

  function openCreateUser() {
    setEditingUser(null);
    setUFullName("");
    setUEmail("");
    setUPhone("");
    setUPassword("");
    setURoleIds([]);
    setUBranchIds([]);
    setUIsActive(true);
    setUReason("");
    setUError(null);
    setUserModalOpen(true);
  }

  function openEditUser(user: UserRow) {
    setEditingUser(user);
    setUFullName(user.fullName);
    setUEmail(user.email ?? "");
    setUPhone(user.phone ?? "");
    setUPassword("");
    setURoleIds(user.userRoles.map((r) => r.role.id));
    setUBranchIds(user.userBranches.map((b) => b.branch.id));
    setUIsActive(user.isActive);
    setUReason("");
    setUError(null);
    setUserModalOpen(true);
  }

  function toggle(list: string[], id: string, setter: (v: string[]) => void) {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function submitUser(event: FormEvent) {
    event.preventDefault();
    setUSubmitting(true);
    setUError(null);
    try {
      if (editingUser) {
        await apiPatch(`/api/users/${editingUser.id}`, {
          fullName: uFullName.trim(),
          email: uEmail.trim() || null,
          phone: uPhone.trim() || null,
          isActive: uIsActive,
          roleIds: uRoleIds,
          branchIds: uBranchIds,
          newPassword: uPassword.trim() || undefined,
          reason: uReason.trim()
        });
        toast.success(t("common.saved"));
      } else {
        await apiPost("/api/users", {
          fullName: uFullName.trim(),
          email: uEmail.trim() || undefined,
          phone: uPhone.trim() || undefined,
          password: uPassword,
          roleIds: uRoleIds,
          branchIds: uBranchIds,
          isActive: uIsActive
        });
        toast.success(t("common.created"));
      }
      setUserModalOpen(false);
      reloadUsers();
    } catch (err) {
      setUError(err instanceof Error ? err.message : "Failed to save user.");
    } finally {
      setUSubmitting(false);
    }
  }

  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  async function handleDeactivate(reason: string) {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await apiDelete(`/api/users/${deactivateTarget.id}`, { reason });
      toast.success(t("common.saved"));
      setDeactivateTarget(null);
      reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deactivate user.");
    } finally {
      setDeactivating(false);
    }
  }

  // ---- Roles & permissions tab ----
  const { data: permissionCatalog } = useApi<PermissionCatalog>(tab === "roles" ? "/api/permissions" : null, [tab]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [roleReason, setRoleReason] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedRoleId && roles && roles[0]) setSelectedRoleId(roles[0].id);
  }, [roles, selectedRoleId]);

  useEffect(() => {
    const role = roles?.find((r) => r.id === selectedRoleId);
    if (role) setRolePermissions(role.permissionKeys);
  }, [selectedRoleId, roles]);

  const selectedRole = roles?.find((r) => r.id === selectedRoleId);

  async function saveRolePermissions() {
    if (!selectedRoleId) return;
    setRoleSaving(true);
    setRoleError(null);
    try {
      await apiPatch(`/api/roles/${selectedRoleId}`, {
        permissionKeys: rolePermissions,
        reason: roleReason.trim() || "Updated via Users & Permissions screen"
      });
      toast.success(t("common.saved"));
      setRoleReason("");
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "Failed to save permissions.");
    } finally {
      setRoleSaving(false);
    }
  }

  // ---- Sessions tab ----
  const { data: sessions, loading: sessionsLoading, error: sessionsError, reload: reloadSessions } = useApi<
    SessionRow[]
  >(tab === "sessions" ? "/api/auth/sessions" : null, [tab]);

  async function revokeSession(id: string) {
    try {
      await apiDelete(`/api/auth/sessions/${id}`);
      toast.success(t("common.saved"));
      reloadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke session.");
    }
  }

  async function revokeAllSessions() {
    try {
      await apiDelete("/api/auth/sessions");
      toast.success(t("users.revokeAll"));
      reloadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke sessions.");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("users.title")} />

      <div className="flex gap-2 border-b border-black/10 dark:border-white/10">
        {(["users", "roles", "sessions"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === tabKey
                ? "border-b-2 border-tecno-gold text-tecno-gold-dark dark:text-tecno-gold"
                : "text-black/55 dark:text-white/55"
            }`}
          >
            {tabKey === "users" ? t("users.title") : tabKey === "roles" ? t("users.roles") : t("users.sessions")}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={openCreateUser} disabled={!roles?.length}>
              {t("users.add")}
            </button>
          </div>
          <ErrorNotice message={usersError} />
          <DataTable
            columns={["Name", "Contact", t("users.roles"), t("common.branch"), t("common.status"), t("common.actions")]}
            loading={usersLoading}
            isEmpty={(usersData?.length ?? 0) === 0}
            emptyTitle={t("users.empty")}
          >
            {usersData?.map((u) => (
              <tr key={u.id} className="border-b border-black/5 dark:border-white/5">
                <td className="p-3 font-medium">{u.fullName}</td>
                <td className="p-3 text-xs">
                  {u.email ?? "—"}
                  <br />
                  {u.phone ?? ""}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {u.userRoles.map((r) => (
                      <Badge key={r.role.id} tone="brand">
                        {r.role.name}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="p-3 text-xs">{u.userBranches.map((b) => b.branch.name).join(", ") || "All"}</td>
                <td className="p-3">
                  <Badge tone={u.isActive ? "success" : "neutral"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                  {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                    <span className="ms-1 text-xs text-red-600 dark:text-red-400">Locked</span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex gap-3">
                    <button type="button" className="text-xs hover:underline" onClick={() => openEditUser(u)}>
                      {t("common.edit")}
                    </button>
                    {u.isActive && (
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline dark:text-red-400"
                        onClick={() => setDeactivateTarget(u)}
                      >
                        {t("common.delete")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {tab === "roles" && (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="card divide-y divide-black/5 dark:divide-white/5">
            {roles?.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setSelectedRoleId(role.id)}
                className={`block w-full px-3 py-2 text-start text-sm ${
                  role.id === selectedRoleId ? "bg-tecno-gold/10 font-medium" : "hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {role.name}
                <span className="ms-2 text-xs text-black/45 dark:text-white/45">({role.userCount})</span>
              </button>
            ))}
          </div>

          <div className="card space-y-4 p-4">
            <ErrorNotice message={roleError} />
            {selectedRole && (
              <>
                <div>
                  <p className="font-medium">{selectedRole.name}</p>
                  {selectedRole.description && (
                    <p className="text-sm text-black/55 dark:text-white/55">{selectedRole.description}</p>
                  )}
                  {selectedRole.isSystem && <Badge tone="neutral">System role</Badge>}
                </div>

                <div className="max-h-[420px] space-y-4 overflow-y-auto pe-2">
                  {permissionCatalog &&
                    Object.entries(permissionCatalog.modules).map(([module, perms]) => (
                      <div key={module}>
                        <p className="mb-1 text-xs font-semibold uppercase text-black/50 dark:text-white/50">{module}</p>
                        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                          {perms.map((p) => (
                            <label key={p.key} className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={rolePermissions.includes(p.key)}
                                onChange={() => toggle(rolePermissions, p.key, setRolePermissions)}
                                className="h-3.5 w-3.5"
                              />
                              {p.key}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>

                <input
                  className="input"
                  placeholder={`${t("common.reason")} (optional)`}
                  value={roleReason}
                  onChange={(e) => setRoleReason(e.target.value)}
                />
                <button type="button" className="btn-primary" disabled={roleSaving} onClick={saveRolePermissions}>
                  {roleSaving ? t("common.loading") : t("common.save")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "sessions" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={revokeAllSessions}>
              {t("users.revokeAll")}
            </button>
          </div>
          <ErrorNotice message={sessionsError} />
          <DataTable
            columns={["Device", "IP", "Last seen", "Expires", ""]}
            loading={sessionsLoading}
            isEmpty={(sessions?.length ?? 0) === 0}
            emptyTitle={t("users.empty")}
          >
            {sessions?.map((s) => (
              <tr key={s.id} className="border-b border-black/5 dark:border-white/5">
                <td className="max-w-xs truncate p-3 text-xs" title={s.userAgent ?? ""}>
                  {s.userAgent ?? "—"} {s.current && <Badge tone="brand">This device</Badge>}
                </td>
                <td className="p-3 font-mono text-xs">{s.ipAddress ?? "—"}</td>
                <td className="p-3">{formatDateTime(s.lastSeenAt)}</td>
                <td className="p-3">{formatDateTime(s.expiresAt)}</td>
                <td className="p-3">
                  {!s.current && (
                    <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => revokeSession(s.id)}>
                      {t("common.delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      <Modal open={userModalOpen} title={editingUser ? t("common.edit") : t("users.add")} onClose={() => setUserModalOpen(false)}>
        <form onSubmit={submitUser} className="space-y-3">
          <ErrorNotice message={uError} />
          <Field label="Full name" required>
            {(id) => <input id={id} className="input" value={uFullName} onChange={(e) => setUFullName(e.target.value)} required />}
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Email">
              {(id) => <input id={id} type="email" className="input" value={uEmail} onChange={(e) => setUEmail(e.target.value)} />}
            </Field>
            <Field label="Phone">
              {(id) => <input id={id} className="input" value={uPhone} onChange={(e) => setUPhone(e.target.value)} />}
            </Field>
          </div>
          <Field label={editingUser ? t("users.changePassword") : "Password"} required={!editingUser} hint={editingUser ? "Leave blank to keep the current password" : "At least 10 characters, letters and numbers"}>
            {(id) => (
              <input
                id={id}
                type="password"
                className="input"
                value={uPassword}
                onChange={(e) => setUPassword(e.target.value)}
                required={!editingUser}
              />
            )}
          </Field>
          <Field label={t("users.roles")} required>
            {() => (
              <div className="flex flex-wrap gap-2">
                {roles?.map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={uRoleIds.includes(r.id)}
                      onChange={() => toggle(uRoleIds, r.id, setURoleIds)}
                      className="h-3.5 w-3.5"
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            )}
          </Field>
          <Field label={t("common.branch")} hint="Leave empty for organization-wide access">
            {() => (
              <div className="flex flex-wrap gap-2">
                {branches?.map((b) => (
                  <label key={b.id} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={uBranchIds.includes(b.id)}
                      onChange={() => toggle(uBranchIds, b.id, setUBranchIds)}
                      className="h-3.5 w-3.5"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={uIsActive} onChange={(e) => setUIsActive(e.target.checked)} className="h-4 w-4" />
            Active
          </label>
          {editingUser && (
            <Field label={`${t("common.reason")} (recorded in the audit log)`} required>
              {(id) => <input id={id} className="input" value={uReason} onChange={(e) => setUReason(e.target.value)} required />}
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setUserModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={uSubmitting || !uFullName.trim() || uRoleIds.length === 0 || (editingUser ? uReason.trim().length < 3 : !uPassword)}
            >
              {uSubmitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title={t("common.delete")}
        message={`Deactivate ${deactivateTarget?.fullName}? They will be signed out everywhere and can no longer log in.`}
        confirmLabel={t("common.delete")}
        requireReason
        busy={deactivating}
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
      />
    </div>
  );
}
