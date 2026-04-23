"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">Something went wrong</h1>
          <p className="mb-6 text-sm text-gray-500">An unexpected error occurred.</p>
          <button
            onClick={() => reset()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
