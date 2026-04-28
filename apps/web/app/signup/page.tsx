"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Tab = "create" | "join";

/**
 * Two-path signup page:
 *   1. "Create new business"  — admin signs up without an orgCode; the
 *      onboarding wizard creates the org on first dashboard visit.
 *   2. "Join existing business" — driver/dispatcher signs up with an
 *      orgCode that the admin shares (from Organization Settings).
 *
 * The flow always goes through POST /auth/signup (via plain fetch, because
 * apiFetch requires an existing Firebase session — circular here), and then
 * syncs the browser's Firebase Auth state via signInWithEmailAndPassword so
 * the AuthProvider picks up the new user.
 */
export default function SignupPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [tab, setTab] = useState<Tab>("create");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [joinRole, setJoinRole] = useState<"driver" | "dispatcher">("driver");
  const [orgCode, setOrgCode] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [user, loading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Client-side guard: Join tab requires orgCode.
    if (tab === "join" && !orgCode.trim()) {
      setError("Organization code is required to join an existing business");
      return;
    }

    setSubmitting(true);
    try {
      const body =
        tab === "create"
          ? { email, password, name, role: "admin" as const }
          : {
              email,
              password,
              name,
              role: joinRole,
              orgCode: orgCode.trim(),
            };

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

      router.replace(tab === "create" ? "/onboarding" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-3xl font-bold text-gray-900">
          Create your account
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          {tab === "create"
            ? "Set up a new business and invite your team."
            : "Join your team using the code your admin shared."}
        </p>

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
            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none"
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

          {tab === "join" && (
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
