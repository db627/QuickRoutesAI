"use client";

import { ReactNode } from "react";

interface WizardShellProps {
  currentStep: 1 | 2 | 3;
  totalSteps: number;
  title: string;
  children: ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  submitting?: boolean;
}

export default function WizardShell({
  currentStep,
  totalSteps,
  title,
  children,
  onBack,
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  submitting = false,
}: WizardShellProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-6">
      <div className="w-full rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-2" role="list" aria-label="Wizard progress">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
            <div
              key={step}
              role="listitem"
              aria-current={step === currentStep ? "step" : undefined}
              data-active={step === currentStep}
              data-complete={step < currentStep}
              className={`h-2 w-12 rounded-full ${
                step < currentStep
                  ? "bg-green-500"
                  : step === currentStep
                    ? "bg-blue-500"
                    : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        <h1 className="mb-6 text-2xl font-semibold text-gray-900">{title}</h1>

        <div className="mb-6">{children}</div>

        <div className="flex justify-between">
          <button
            type="button"
            onClick={onBack}
            disabled={!onBack || submitting}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled || submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Saving..." : nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
