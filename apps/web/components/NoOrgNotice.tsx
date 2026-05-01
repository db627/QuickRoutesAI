"use client";

import { useAuth } from "@/lib/auth-context";

export default function NoOrgNotice() {
  const { logout } = useAuth();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-semibold text-gray-900">Waiting for organization setup</h1>
        <p className="mb-4 text-sm text-gray-600">
          Your account isn&apos;t linked to an organization yet. Ask your admin to finish setup, or sign out and wait for an invite.
        </p>
        <button
          onClick={logout}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
