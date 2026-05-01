"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { apiFetch } from "@/lib/api";
import type {
  OrgBasicsInput,
  OrgAddressInput,
  AdminProfileInput,
  WizardProgressInput,
} from "@quickroutesai/shared";
import WizardShell from "./components/WizardShell";
import Step1OrgBasics, { validateStep1 } from "./components/Step1OrgBasics";
import Step2Address, { validateStep2 } from "./components/Step2Address";
import Step3AdminProfile, { validateStep3 } from "./components/Step3AdminProfile";
import SuccessScreen from "./components/SuccessScreen";

type FieldErrors<T> = Partial<Record<keyof T, string>>;

interface WizardData {
  orgBasics: Partial<OrgBasicsInput>;
  address: Partial<OrgAddressInput>;
  adminProfile: Partial<AdminProfileInput>;
}

const EMPTY: WizardData = {
  orgBasics: {},
  address: { country: "US" },
  adminProfile: {},
};

function zodErrorsToFieldMap<T>(error: {
  errors: { path: (string | number)[]; message: string }[];
}): FieldErrors<T> {
  const map: FieldErrors<T> = {};
  for (const issue of error.errors) {
    const key = issue.path[0] as keyof T;
    if (key && !map[key]) map[key] = issue.message;
  }
  return map;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user, role, loading: authLoading, refresh } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [data, setData] = useState<WizardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [doneOrgName, setDoneOrgName] = useState<string | null>(null);

  const [errors1, setErrors1] = useState<FieldErrors<OrgBasicsInput>>({});
  const [errors2, setErrors2] = useState<FieldErrors<OrgAddressInput>>({});
  const [errors3, setErrors3] = useState<FieldErrors<AdminProfileInput>>({});

  // Gate: only admins allowed here.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (role !== "admin") {
      router.replace("/dashboard");
    }
  }, [authLoading, user, role, router]);

  // Initial load: fetch saved progress.
  useEffect(() => {
    if (authLoading || !user || role !== "admin") return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch<{ wizardProgress: WizardProgressInput | null }>(
          "/me/wizard-progress",
        );
        if (cancelled) return;
        if (resp.wizardProgress) {
          setStep(resp.wizardProgress.currentStep);
          setData({
            orgBasics: resp.wizardProgress.data.orgBasics ?? {},
            address: resp.wizardProgress.data.address ?? { country: "US" },
            adminProfile: resp.wizardProgress.data.adminProfile ?? {},
          });
        }
      } catch {
        // Non-fatal: start fresh.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, role]);

  const persistProgress = useCallback(
    async (nextStep: 1 | 2 | 3, mergedData: WizardData) => {
      const dataForApi: WizardProgressInput["data"] = {};

      const hasOrgBasicsData = Object.values(mergedData.orgBasics).some(Boolean);
      if (hasOrgBasicsData) {
        dataForApi.orgBasics = mergedData.orgBasics as OrgBasicsInput;
      }

      const hasAddressData = Object.keys(mergedData.address).some(
        (k) => k !== "country" && Boolean(mergedData.address[k as keyof OrgAddressInput]),
      );
      if (hasAddressData) {
        dataForApi.address = mergedData.address as OrgAddressInput;
      }

      const hasAdminProfileData = Object.values(mergedData.adminProfile).some(Boolean);
      if (hasAdminProfileData) {
        dataForApi.adminProfile = mergedData.adminProfile as AdminProfileInput;
      }
      try {
        await apiFetch("/me/wizard-progress", {
          method: "PATCH",
          body: JSON.stringify({ currentStep: nextStep, data: dataForApi }),
        });
      } catch {
        toast.error("Couldn't save progress — you can keep going");
      }
    },
    [toast],
  );

  const handleNextFrom1 = async () => {
    const result = validateStep1(data.orgBasics);
    if (!result.success) {
      setErrors1(zodErrorsToFieldMap<OrgBasicsInput>(result.error));
      return;
    }
    setErrors1({});
    const merged = { ...data, orgBasics: result.data };
    setData(merged);
    setStep(2);
    await persistProgress(2, merged);
  };

  const handleNextFrom2 = async () => {
    const result = validateStep2(data.address);
    if (!result.success) {
      setErrors2(zodErrorsToFieldMap<OrgAddressInput>(result.error));
      return;
    }
    setErrors2({});
    const merged = { ...data, address: result.data };
    setData(merged);
    setStep(3);
    await persistProgress(3, merged);
  };

  const handleFinish = async () => {
    const result = validateStep3(data.adminProfile);
    if (!result.success) {
      setErrors3(zodErrorsToFieldMap<AdminProfileInput>(result.error));
      return;
    }
    setErrors3({});
    const merged = { ...data, adminProfile: result.data };
    setData(merged);

    setSubmitting(true);
    try {
      const resp = await apiFetch<{ org: { id: string; name: string }; user: { orgId: string } }>(
        "/orgs",
        {
          method: "POST",
          body: JSON.stringify({
            orgBasics: merged.orgBasics,
            address: merged.address,
            adminProfile: merged.adminProfile,
          }),
        },
      );
      await refresh();
      setDoneOrgName(resp.org.name);
    } catch (err: any) {
      const message = err?.message ?? "Something went wrong";
      if (/already belongs/i.test(message)) {
        toast.info("Your organization is already set up");
        router.replace("/dashboard");
        return;
      }
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (doneOrgName !== null) {
    return <SuccessScreen orgName={doneOrgName} />;
  }

  if (step === 1) {
    return (
      <WizardShell
        currentStep={1}
        totalSteps={3}
        title="Tell us about your organization"
        onNext={handleNextFrom1}
      >
        <Step1OrgBasics
          value={data.orgBasics}
          onChange={(next) => setData({ ...data, orgBasics: next })}
          errors={errors1}
        />
      </WizardShell>
    );
  }

  if (step === 2) {
    return (
      <WizardShell
        currentStep={2}
        totalSteps={3}
        title="Primary address"
        onBack={() => setStep(1)}
        onNext={handleNextFrom2}
      >
        <Step2Address
          value={data.address}
          onChange={(next) => setData({ ...data, address: { country: "US", ...next } })}
          errors={errors2}
        />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      currentStep={3}
      totalSteps={3}
      title="Your admin profile"
      onBack={() => setStep(2)}
      onNext={handleFinish}
      nextLabel="Finish"
      submitting={submitting}
    >
      <Step3AdminProfile
        value={data.adminProfile}
        onChange={(next) => setData({ ...data, adminProfile: next })}
        errors={errors3}
      />
    </WizardShell>
  );
}
