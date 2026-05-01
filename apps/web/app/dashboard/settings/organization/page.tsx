"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { apiFetch } from "@/lib/api";
import {
  updateOrgSchema,
  type Org,
  type OrgBasicsInput,
  type OrgAddressInput,
  type UpdateOrgInput,
  type Invite,
} from "@quickroutesai/shared";

const INDUSTRY_OPTIONS: { value: OrgBasicsInput["industry"]; label: string }[] = [
  { value: "delivery", label: "Delivery" },
  { value: "logistics", label: "Logistics" },
  { value: "field_service", label: "Field Service" },
  { value: "other", label: "Other" },
];

const FLEET_SIZE_OPTIONS: OrgBasicsInput["fleetSize"][] = [
  "1-5",
  "6-20",
  "21-50",
  "51-200",
  "200+",
];

const ADDRESS_FIELDS: { key: keyof OrgAddressInput; label: string }[] = [
  { key: "street", label: "Street" },
  { key: "city", label: "City" },
  { key: "state", label: "State / Region" },
  { key: "zip", label: "ZIP / Postal code" },
  { key: "country", label: "Country (ISO-3166 alpha-2, e.g. US)" },
];

interface FormState {
  name: string;
  industry: OrgBasicsInput["industry"] | "";
  fleetSize: OrgBasicsInput["fleetSize"] | "";
  address: OrgAddressInput;
}

function orgToForm(org: Org): FormState {
  return {
    name: org.name,
    industry: org.industry,
    fleetSize: org.fleetSize,
    address: { ...org.address },
  };
}

/**
 * Diff the edited form against the original org, returning only
 * the fields that changed. We use this so PATCH only sends what moved.
 */
function buildPatch(original: Org, form: FormState): UpdateOrgInput {
  const patch: UpdateOrgInput = {};
  if (form.name !== original.name) patch.name = form.name;
  if (form.industry && form.industry !== original.industry) {
    patch.industry = form.industry;
  }
  if (form.fleetSize && form.fleetSize !== original.fleetSize) {
    patch.fleetSize = form.fleetSize;
  }

  const addressChanged = (Object.keys(form.address) as (keyof OrgAddressInput)[]).some(
    (k) => form.address[k] !== original.address[k],
  );
  if (addressChanged) patch.address = form.address;

  return patch;
}

export default function OrganizationSettingsPage() {
  const { role, orgId } = useAuth();
  const { toast } = useToast();

  const [org, setOrg] = useState<Org | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "admin" || !orgId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<Org>(`/orgs/${orgId}`);
        if (cancelled) return;
        setOrg(data);
        setForm(orgToForm(data));
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load organization");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, orgId]);

  // ── Early returns ─────────────────────────────────────────────────────

  if (role !== "admin") {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900">Access denied</h1>
        <p className="mt-2 text-sm text-gray-500">
          You don&apos;t have access to this page.
        </p>
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900">No organization linked</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your account isn&apos;t linked to an organization yet.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div
          data-testid="org-settings-spinner"
          className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
        />
      </div>
    );
  }

  if (loadError || !org || !form) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {loadError ?? "Failed to load organization."}
      </div>
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────

  const updateAddressField = (key: keyof OrgAddressInput, value: string) => {
    setForm({ ...form, address: { ...form.address, [key]: value } });
  };

  const handleSave = async () => {
    const patch = buildPatch(org, form);

    // Validate the patch (even the empty object is allowed — we early-return below)
    const result = updateOrgSchema.safeParse(patch);
    if (!result.success) {
      const map: Record<string, string> = {};
      for (const issue of result.error.errors) {
        const path = issue.path.join(".");
        if (!map[path]) map[path] = issue.message;
      }
      setErrors(map);
      return;
    }
    setErrors({});

    if (Object.keys(patch).length === 0) {
      toast.info("No changes to save");
      return;
    }

    setSaving(true);
    try {
      const updated = await apiFetch<Org>(`/orgs/${orgId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setOrg(updated);
      setForm(orgToForm(updated));
      toast.success("Organization updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update organization");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(orgId);
      toast.success("Code copied to clipboard");
    } catch {
      toast.error("Failed to copy code");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organization Settings</h1>
        <p className="text-sm text-gray-500">
          Update your organization&apos;s profile and primary address.
        </p>
      </div>

      {/* Team Invite Code — the org id IS the code. Admins share it with
          teammates so they can self-join via the "Join existing business"
          flow on /signup. */}
      <section
        aria-labelledby="invite-code-heading"
        className="space-y-3 rounded-xl border border-brand-200 bg-brand-50 p-6"
      >
        <h2 id="invite-code-heading" className="text-base font-semibold text-gray-900">
          Team Invite Code
        </h2>
        <p className="text-sm text-gray-700">
          Share this code with your teammates when they sign up via the
          &quot;Join existing business&quot; option.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <code
            data-testid="invite-code"
            className="flex-1 break-all rounded-md border border-brand-200 bg-white px-3 py-2 font-mono text-sm text-gray-900"
          >
            {orgId}
          </code>
          <button
            type="button"
            onClick={handleCopyCode}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Copy
          </button>
        </div>
      </section>

      <InviteTeamSection />


      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-gray-900">Organization details</h2>

        <div>
          <label htmlFor="org-name" className="mb-1 block text-sm font-medium text-gray-700">
            Organization name
          </label>
          <input
            id="org-name"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
        </div>

        <div>
          <label htmlFor="org-industry" className="mb-1 block text-sm font-medium text-gray-700">
            Industry
          </label>
          <select
            id="org-industry"
            value={form.industry}
            onChange={(e) =>
              setForm({ ...form, industry: e.target.value as OrgBasicsInput["industry"] })
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {INDUSTRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {errors.industry && <p className="mt-1 text-sm text-red-600">{errors.industry}</p>}
        </div>

        <div>
          <label htmlFor="fleet-size" className="mb-1 block text-sm font-medium text-gray-700">
            Fleet size
          </label>
          <select
            id="fleet-size"
            value={form.fleetSize}
            onChange={(e) =>
              setForm({ ...form, fleetSize: e.target.value as OrgBasicsInput["fleetSize"] })
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {FLEET_SIZE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {errors.fleetSize && <p className="mt-1 text-sm text-red-600">{errors.fleetSize}</p>}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-gray-900">Primary address</h2>

        {ADDRESS_FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`addr-${f.key}`} className="mb-1 block text-sm font-medium text-gray-700">
              {f.label}
            </label>
            <input
              id={`addr-${f.key}`}
              type="text"
              value={form.address[f.key] ?? ""}
              onChange={(e) => updateAddressField(f.key, e.target.value)}
              maxLength={f.key === "country" ? 2 : undefined}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            {errors[`address.${f.key}`] && (
              <p className="mt-1 text-sm text-red-600">{errors[`address.${f.key}`]}</p>
            )}
          </div>
        ))}
      </section>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

/**
 * "Invite team members" panel — generates per-email invite links.
 *
 * Each invite is a Firestore doc whose id IS the token, e.g. the link
 * `<APP_URL>/signup?invite=<token>` resolves the token via
 * `GET /invites/lookup/:token` from the public signup page.
 *
 * The list lives here (rather than in a parent) because it's tightly coupled
 * to the form's submit handler — keeping them together avoids prop drilling
 * a refresh callback.
 */
function InviteTeamSection() {
  const { toast } = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"driver" | "dispatcher">("driver");
  const [submitting, setSubmitting] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // window is undefined in SSR; capture origin only on the client.
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const refresh = async () => {
    try {
      const res = await apiFetch<{ data: Invite[] }>("/invites");
      setInvites(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load invites");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch<Invite>("/invites", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role }),
      });
      toast.success("Invite created");
      setEmail("");
      setRole("driver");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async (token: string) => {
    const link = `${origin}/signup?invite=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apiFetch<void>(`/invites/${id}`, { method: "DELETE" });
      toast.success("Invite revoked");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke invite");
    }
  };

  return (
    <section
      aria-labelledby="invite-team-heading"
      className="space-y-4 rounded-xl border border-gray-200 bg-white p-6"
    >
      <div>
        <h2 id="invite-team-heading" className="text-base font-semibold text-gray-900">
          Invite team members
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Generate a one-time invite link per email. Share the link via Slack,
          email, or any other channel — the invitee&apos;s role and organization
          are pre-filled when they open it.
        </p>
      </div>

      <form onSubmit={handleSend} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          aria-label="Invite email"
          type="email"
          required
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          aria-label="Invite role"
          value={role}
          onChange={(e) => setRole(e.target.value as "driver" | "dispatcher")}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="driver">Driver</option>
          <option value="dispatcher">Dispatcher</option>
        </select>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send invite"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">Loading invites…</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-gray-500">No pending invites.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3">Link</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const link = `${origin}/signup?invite=${inv.id}`;
                return (
                  <tr key={inv.id} className="border-t border-gray-200">
                    <td className="py-2 pr-3 align-top text-gray-900">{inv.email}</td>
                    <td className="py-2 pr-3 align-top capitalize text-gray-700">{inv.role}</td>
                    <td className="py-2 pr-3 align-top text-gray-500">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <code
                        data-testid={`invite-link-${inv.id}`}
                        className="block max-w-[18rem] truncate rounded bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700"
                        title={link}
                      >
                        {link}
                      </code>
                    </td>
                    <td className="py-2 pr-3 align-top text-right">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyLink(inv.id)}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Copy link
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevoke(inv.id)}
                          className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

