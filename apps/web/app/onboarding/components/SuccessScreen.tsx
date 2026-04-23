"use client";

import { useRouter } from "next/navigation";

export default function SuccessScreen({ orgName }: { orgName: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-6">
      <div className="w-full rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">You&apos;re all set</h1>
        <p className="mb-6 text-sm text-gray-600">
          {orgName ? <><strong>{orgName}</strong> is ready to go.</> : "Your organization is ready to go."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );
}
