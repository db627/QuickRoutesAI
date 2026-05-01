"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { UserProfile, UserRole } from "@quickroutesai/shared";

const PAGE_SIZE = 20;

const roleBadgeClass: Record<UserRole, string> = {
  admin: "bg-purple-50 text-purple-700",
  dispatcher: "bg-blue-50 text-blue-700",
  driver: "bg-green-50 text-green-700",
};

function statusBadgeClass(status?: string) {
  return status === "deactivated"
    ? "bg-red-50 text-red-700"
    : "bg-green-50 text-green-700";
}

interface RoleConfirm {
  uid: string;
  name: string;
  currentRole: UserRole;
  newRole: UserRole;
}

interface DeactivateConfirm {
  uid: string;
  name: string;
  isDeactivated: boolean;
}

interface RemoveOrgConfirm {
  uid: string;
  name: string;
}

export default function UsersPage() {
  const { user, role: myRole, orgId: myOrgId, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState<string | null>(null);
  const [roleConfirm, setRoleConfirm] = useState<RoleConfirm | null>(null);
  const [deactivateConfirm, setDeactivateConfirm] = useState<DeactivateConfirm | null>(null);
  const [removeOrgConfirm, setRemoveOrgConfirm] = useState<RemoveOrgConfirm | null>(null);
  const [actionError, setActionError] = useState("");

  // ── Unassigned users (separate query — fetched from API, not Firestore) ────
  const [unassigned, setUnassigned] = useState<UserProfile[]>([]);
  const [unassignedLoading, setUnassignedLoading] = useState(true);
  const [unassignedError, setUnassignedError] = useState("");

  // Role gate — redirect non-admins
  useEffect(() => {
    if (!authLoading && myRole !== "admin") {
      router.replace("/dashboard");
    }
  }, [authLoading, myRole, router]);

  // Subscribe to the users collection in real time.
  // The org-scoped section filters client-side by orgId === myOrgId. The
  // separate "Unassigned" section is fetched from the API since onSnapshot
  // here may or may not include unassigned docs depending on Firestore rules.
  useEffect(() => {
    if (authLoading || myRole !== "admin") return;

    const unsub = onSnapshot(collection(firestore, "users"), (snapshot) => {
      setUsers(
        snapshot.docs.map((doc) => ({
          uid: doc.id,
          ...(doc.data() as Omit<UserProfile, "uid">),
        })),
      );
      setDataLoading(false);
    });

    return unsub;
  }, [authLoading, myRole]);

  // Fetch unassigned users from the API
  const refreshUnassigned = useCallback(async () => {
    if (myRole !== "admin") return;
    setUnassignedLoading(true);
    setUnassignedError("");
    try {
      const res = await apiFetch<{ data: UserProfile[] }>("/users/unassigned");
      setUnassigned(res.data);
    } catch (err) {
      setUnassignedError(
        err instanceof Error ? err.message : "Failed to load unassigned users",
      );
    } finally {
      setUnassignedLoading(false);
    }
  }, [myRole]);

  useEffect(() => {
    if (authLoading || myRole !== "admin") return;
    refreshUnassigned();
  }, [authLoading, myRole, refreshUnassigned]);

  // Reset to page 1 whenever the search term changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  // ── Derived data ────────────────────────────────────────────────────────────

  // Restrict the org-scoped table to users in the admin's own org. Unassigned
  // and other-org users (if any leak through onSnapshot) are excluded.
  const orgUsers = users.filter((u) => myOrgId && u.orgId === myOrgId);

  const filtered = orgUsers.filter(
    (u) =>
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()),
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleRoleSelect(u: UserProfile, newRole: UserRole) {
    if (newRole === u.role) return;
    setActionError("");
    setRoleConfirm({ uid: u.uid, name: u.name, currentRole: u.role, newRole });
  }

  async function confirmRoleChange() {
    if (!roleConfirm) return;
    setSaving(roleConfirm.uid);
    setActionError("");
    try {
      await apiFetch(`/users/${roleConfirm.uid}`, {
        method: "PATCH",
        body: JSON.stringify({ role: roleConfirm.newRole }),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setSaving(null);
      setRoleConfirm(null);
    }
  }

  function handleDeactivateClick(u: UserProfile) {
    setActionError("");
    setDeactivateConfirm({
      uid: u.uid,
      name: u.name,
      isDeactivated: u.status === "deactivated",
    });
  }

  async function confirmDeactivate() {
    if (!deactivateConfirm) return;
    const newStatus = deactivateConfirm.isDeactivated ? "active" : "deactivated";
    setSaving(deactivateConfirm.uid);
    setActionError("");
    try {
      await apiFetch(`/users/${deactivateConfirm.uid}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSaving(null);
      setDeactivateConfirm(null);
    }
  }

  async function handleAddToOrg(u: UserProfile) {
    if (!myOrgId) return;
    setSaving(u.uid);
    setActionError("");
    try {
      await apiFetch(`/users/${u.uid}`, {
        method: "PATCH",
        body: JSON.stringify({ orgId: myOrgId }),
      });
      toast.success(`${u.name || u.email} added to your organization`);
      // Optimistically drop from the unassigned list; onSnapshot will pick
      // up the new orgId on the user doc and add them to the main table.
      setUnassigned((prev) => prev.filter((x) => x.uid !== u.uid));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add user";
      toast.error(message);
      setActionError(message);
    } finally {
      setSaving(null);
    }
  }

  function handleRemoveFromOrgClick(u: UserProfile) {
    setActionError("");
    setRemoveOrgConfirm({ uid: u.uid, name: u.name });
  }

  async function confirmRemoveFromOrg() {
    if (!removeOrgConfirm) return;
    setSaving(removeOrgConfirm.uid);
    setActionError("");
    try {
      await apiFetch(`/users/${removeOrgConfirm.uid}`, {
        method: "PATCH",
        body: JSON.stringify({ orgId: null }),
      });
      toast.success(`${removeOrgConfirm.name} removed from your organization`);
      // Refetch unassigned list — the just-removed user now belongs there.
      await refreshUnassigned();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove user";
      toast.error(message);
      setActionError(message);
    } finally {
      setSaving(null);
      setRemoveOrgConfirm(null);
    }
  }

  // ── Early returns ─────────────────────────────────────────────────────────────

  // Show spinner while auth resolves
  if (authLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  // Non-admin: redirect is firing, render nothing
  if (myRole !== "admin") return null;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500">Manage roles and account access.</p>
        </div>
        {!dataLoading && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-500">
            {filtered.length} user{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {actionError}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-5 py-3 text-left font-semibold text-gray-600">Name</th>
                <th className="px-5 py-3 text-left font-semibold text-gray-600">Email</th>
                <th className="px-5 py-3 text-left font-semibold text-gray-600">Role</th>
                <th className="px-5 py-3 text-left font-semibold text-gray-600">Status</th>
                <th className="px-5 py-3 text-left font-semibold text-gray-600">Created</th>
                <th className="px-5 py-3 text-right font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {dataLoading ? (
                // Loading skeleton
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-5 py-4">
                      <div className="h-4 w-28 animate-pulse rounded bg-gray-200" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-5 w-16 animate-pulse rounded-full bg-gray-200" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-5 w-14 animate-pulse rounded-full bg-gray-200" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="ml-auto h-7 w-20 animate-pulse rounded-lg bg-gray-200" />
                    </td>
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                    {search ? "No users match your search." : "No users found."}
                  </td>
                </tr>
              ) : (
                paginated.map((u) => {
                  const isMe = u.uid === user?.uid;
                  const isDeactivated = u.status === "deactivated";
                  const isSaving = saving === u.uid;

                  return (
                    <tr
                      key={u.uid}
                      className={isDeactivated ? "bg-gray-50 opacity-60" : ""}
                    >
                      {/* Name */}
                      <td className="whitespace-nowrap px-5 py-4 font-medium text-gray-900">
                        {u.name || <span className="italic text-gray-400">—</span>}
                        {isMe && (
                          <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">
                            you
                          </span>
                        )}
                      </td>

                      {/* Email */}
                      <td className="px-5 py-4 text-gray-600">{u.email}</td>

                      {/* Role badge */}
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadgeClass[u.role] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {u.role}
                        </span>
                      </td>

                      {/* Status badge */}
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(u.status)}`}
                        >
                          {isDeactivated ? "Deactivated" : "Active"}
                        </span>
                      </td>

                      {/* Created date */}
                      <td className="whitespace-nowrap px-5 py-4 text-gray-400">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {/* Role change dropdown */}
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleSelect(u, e.target.value as UserRole)}
                            disabled={isSaving || isMe || isDeactivated}
                            aria-label={`Change role for ${u.name}`}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <option value="driver">driver</option>
                            <option value="dispatcher">dispatcher</option>
                            <option value="admin">admin</option>
                          </select>

                          {/* Deactivate / Reactivate */}
                          <button
                            onClick={() => handleDeactivateClick(u)}
                            disabled={isSaving || isMe}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                              isDeactivated
                                ? "bg-green-50 text-green-700 hover:bg-green-100"
                                : "bg-red-50 text-red-700 hover:bg-red-100"
                            }`}
                          >
                            {isSaving ? "Saving…" : isDeactivated ? "Reactivate" : "Deactivate"}
                          </button>

                          {/* Remove from organization */}
                          <button
                            onClick={() => handleRemoveFromOrgClick(u)}
                            disabled={isSaving || isMe}
                            aria-label={`Remove ${u.name} from organization`}
                            className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {!dataLoading && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages} &mdash; {filtered.length} user{filtered.length !== 1 ? "s" : ""}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Unassigned users ───────────────────────────────────────────────── */}
      <section aria-labelledby="unassigned-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="unassigned-heading" className="text-lg font-semibold text-gray-900">
              Unassigned users
            </h2>
            <p className="text-sm text-gray-500">
              Drivers and dispatchers who have signed up but aren&apos;t linked to any organization.
            </p>
          </div>
          {!unassignedLoading && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-500">
              {unassigned.length} user{unassigned.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {unassignedError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
            {unassignedError}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Name</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Email</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Role</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {unassignedLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={`unassigned-skel-${i}`}>
                      <td className="px-5 py-4">
                        <div className="h-4 w-28 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-5 py-4">
                        <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-5 py-4">
                        <div className="h-5 w-16 animate-pulse rounded-full bg-gray-200" />
                      </td>
                      <td className="px-5 py-4">
                        <div className="ml-auto h-7 w-32 animate-pulse rounded-lg bg-gray-200" />
                      </td>
                    </tr>
                  ))
                ) : unassigned.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-sm text-gray-400">
                      No unassigned users.
                    </td>
                  </tr>
                ) : (
                  unassigned.map((u) => {
                    const isSaving = saving === u.uid;
                    return (
                      <tr key={u.uid}>
                        <td className="whitespace-nowrap px-5 py-4 font-medium text-gray-900">
                          {u.name || <span className="italic text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-4 text-gray-600">{u.email}</td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadgeClass[u.role] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleAddToOrg(u)}
                              disabled={isSaving || !myOrgId}
                              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {isSaving ? "Adding…" : "Add to my organization"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Role Change Confirmation Modal ─────────────────────────────────── */}
      {roleConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Change Role</h3>
            <p className="mt-2 text-sm text-gray-500">
              Change{" "}
              <span className="font-medium text-gray-900">{roleConfirm.name}</span>
              {"'s role from "}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass[roleConfirm.currentRole]}`}>
                {roleConfirm.currentRole}
              </span>
              {" to "}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass[roleConfirm.newRole]}`}>
                {roleConfirm.newRole}
              </span>
              ?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setRoleConfirm(null)}
                disabled={saving === roleConfirm.uid}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={confirmRoleChange}
                disabled={saving === roleConfirm.uid}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving === roleConfirm.uid ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Deactivate / Reactivate Confirmation Modal ─────────────────────── */}
      {deactivateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              {deactivateConfirm.isDeactivated ? "Reactivate Account" : "Deactivate Account"}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {deactivateConfirm.isDeactivated ? (
                <>
                  Reactivate{" "}
                  <span className="font-medium text-gray-900">{deactivateConfirm.name}</span>?
                  They will be able to log in again.
                </>
              ) : (
                <>
                  Deactivate{" "}
                  <span className="font-medium text-gray-900">{deactivateConfirm.name}</span>?
                  They will immediately lose access and cannot log in until reactivated.
                </>
              )}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeactivateConfirm(null)}
                disabled={saving === deactivateConfirm.uid}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeactivate}
                disabled={saving === deactivateConfirm.uid}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  deactivateConfirm.isDeactivated
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {saving === deactivateConfirm.uid
                  ? "Saving…"
                  : deactivateConfirm.isDeactivated
                    ? "Reactivate"
                    : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove From Organization Confirmation Modal ─────────────────────── */}
      {removeOrgConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Remove from organization</h3>
            <p className="mt-2 text-sm text-gray-500">
              Remove{" "}
              <span className="font-medium text-gray-900">{removeOrgConfirm.name}</span>{" "}
              from your organization? They will lose access to org-scoped data and reappear in the unassigned list.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setRemoveOrgConfirm(null)}
                disabled={saving === removeOrgConfirm.uid}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-900 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveFromOrg}
                disabled={saving === removeOrgConfirm.uid}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving === removeOrgConfirm.uid ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
