"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Tab = "create" | "join";

interface InviteContext {
  email: string;
  role: "driver" | "dispatcher";
  orgId: string;
}

/**
 * Two-path signup page:
 *   1. "Create new business"  — admin signs up without an orgCode; the
 *      onboarding wizard creates the org on first dashboard visit.
 *   2. "Join existing business" — driver/dispatcher signs up with an
 *      orgCode that the admin shares (from Organization Settings).
 *
 * If the URL contains `?invite=<token>`, the page enters "invite mode": it
 * fetches `/invites/lookup/:token` to pre-fill email + role + orgId, locks
 * those fields, and forwards the token to POST /auth/signup so the API can
 * mark the invite used in a transaction.
 *
 * The flow always goes through POST /auth/signup (via plain fetch, because
 * apiFetch requires an existing Firebase session — circular here), and then
 * syncs the browser's Firebase Auth state via signInWithEmailAndPassword so
 * the AuthProvider picks up the new user.
 */
export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams?.get("invite") ?? null;
  const { user, loading } = useAuth();

  const [tab, setTab] = useState<Tab>("create");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [joinRole, setJoinRole] = useState<"driver" | "dispatcher">("driver");
  const [orgCode, setOrgCode] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Invite context: undefined = no token, null = token present but invalid /
  // still loading distinguishes between "bad token" (after fetch) and "loading"
  // via `inviteLoading`. Once `invite` is non-null, we render in invite mode.
  const [invite, setInvite] = useState<InviteContext | null>(null);
  const [inviteLoading, setInviteLoading] = useState<boolean>(!!inviteToken);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [user, loading, router]);

  // Resolve invite token on mount.
  useEffect(() => {
    if (!inviteToken) {
      setInviteLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/invites/lookup/${encodeURIComponent(inviteToken)}`,
        );
        if (!res.ok) {
          throw new Error("This invite link is invalid or has already been used.");
        }
        const data = (await res.json()) as InviteContext;
        if (cancelled) return;
        setInvite(data);
        setEmail(data.email);
        setJoinRole(data.role);
        setOrgCode(data.orgId);
        setTab("join"); // invite mode is always a "join" flow
      } catch (err) {
        if (cancelled) return;
        setInviteError(
          err instanceof Error
            ? err.message
            : "This invite link is invalid or has already been used.",
        );
      } finally {
        if (!cancelled) setInviteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Client-side guard: Join tab requires orgCode (skipped in invite mode
    // since we set orgCode from the invite).
    if (!invite && tab === "join" && !orgCode.trim()) {
      setError("Organization code is required to join an existing business");
      return;
    }

    setSubmitting(true);
    try {
      let body: Record<string, unknown>;
      if (invite && inviteToken) {
        // The API ignores role/orgCode in this body — it uses the invite's
        // stamped values. We send `role` anyway for forward-compat / so the
        // request body still validates if the server's behavior changes.
        body = {
          email,
          password,
          name,
          role: invite.role,
          inviteToken,
        };
      } else if (tab === "create") {
        body = { email, password, name, role: "admin" };
      } else {
        body = {
          email,
          password,
          name,
          role: joinRole,
          orgCode: orgCode.trim(),
        };
      }

      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error || data.message || `Signup failed (${res.status})`,
        );
      }

      // API has already created the Firebase Auth user. Sync the browser's
      // auth state so onAuthStateChanged fires and populates useAuth().
      await signInWithEmailAndPassword(auth, email, password);

      // Invitees and "join" users go to the dashboard; "create" admins go
      // through the onboarding wizard first.
      router.replace(invite || tab === "join" ? "/dashboard" : "/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || inviteLoading) return null;

  // Invite token was provided but failed to resolve — show a friendly error
  // and a fallback link to the regular signup form.
  if (inviteToken && inviteError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Invite unavailable</h1>
          <p role="alert" className="text-sm text-red-600">
            {inviteError}
          </p>
          <Link
            href="/signup"
            className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Sign up normally
          </Link>
        </div>
      </div>
    );
  }

  const inviteMode = !!invite;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-3xl font-bold text-gray-900">
          {inviteMode ? "Accept your invite" : "Create your account"}
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          {inviteMode
            ? `You've been invited as a ${invite.role}. Set a password to finish setting up your account.`
            : tab === "create"
              ? "Set up a new business and invite your team."
              : "Join your team using the code your admin shared."}
        </p>

        {/* Hide the create/join tabs entirely in invite mode — the invite
            already binds the user to a specific org + role and the alternate
            flows would only confuse them. */}
        {!inviteMode && (
          <div
            role="tablist"
            aria-label="Signup type"
            className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1"
          >
            <button
              role="tab"
              aria-selected={tab === "create"}
              type="button"
              onClick={() => {
                setTab("create");
                setError("");
              }}
              className={`rounded-md py-2 text-sm font-medium transition ${
                tab === "create"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Create new business
            </button>
            <button
              role="tab"
              aria-selected={tab === "join"}
              type="button"
              onClick={() => {
                setTab("join");
                setError("");
              }}
              className={`rounded-md py-2 text-sm font-medium transition ${
                tab === "join"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Join existing business
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            aria-label="Full name"
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none"
          />
          <input
            aria-label="Email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            readOnly={inviteMode}
            className={`w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none ${
              inviteMode ? "cursor-not-allowed bg-gray-50 text-gray-600" : ""
            }`}
          />
          <input
            aria-label="Password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none"
          />

          {inviteMode && (
            <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-gray-700">
              <p>
                Invited as{" "}
                <span className="font-medium capitalize text-gray-900">
                  {invite.role}
                </span>
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Organization: <code className="font-mono">{invite.orgId}</code>
              </p>
            </div>
          )}

          {!inviteMode && tab === "join" && (
            <>
              <div>
                <label
                  htmlFor="signup-role"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Role
                </label>
                <select
                  id="signup-role"
                  value={joinRole}
                  onChange={(e) =>
                    setJoinRole(e.target.value as "driver" | "dispatcher")
                  }
                  className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 focus:border-brand-500 focus:outline-none"
                >
                  <option value="driver">Driver</option>
                  <option value="dispatcher">Dispatcher</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="signup-org-code"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Organization code
                </label>
                <input
                  id="signup-org-code"
                  aria-label="Organization code"
                  type="text"
                  placeholder="e.g. 9fJ2kLm…"
                  value={orgCode}
                  onChange={(e) => setOrgCode(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Ask your admin to share your organization&apos;s code.
                </p>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 py-3 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting
              ? "Creating account…"
              : inviteMode
                ? "Accept invite"
                : tab === "create"
                  ? "Create business"
                  : "Join business"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-gray-900 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
