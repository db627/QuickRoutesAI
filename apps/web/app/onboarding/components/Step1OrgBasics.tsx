"use client";

import { orgBasicsSchema, type OrgBasicsInput } from "@quickroutesai/shared";

interface Step1Props {
  value: Partial<OrgBasicsInput>;
  onChange: (next: Partial<OrgBasicsInput>) => void;
  errors?: Partial<Record<keyof OrgBasicsInput, string>>;
}

export const INDUSTRY_OPTIONS: { value: OrgBasicsInput["industry"]; label: string }[] = [
  { value: "delivery", label: "Delivery" },
  { value: "logistics", label: "Logistics" },
  { value: "field_service", label: "Field Service" },
  { value: "other", label: "Other" },
];

export const FLEET_SIZE_OPTIONS: OrgBasicsInput["fleetSize"][] = [
  "1-5",
  "6-20",
  "21-50",
  "51-200",
  "200+",
];

export function validateStep1(value: Partial<OrgBasicsInput>) {
  return orgBasicsSchema.safeParse(value);
}

export default function Step1OrgBasics({ value, onChange, errors }: Step1Props) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="org-name" className="mb-1 block text-sm font-medium text-gray-700">
          Organization name
        </label>
        <input
          id="org-name"
          type="text"
          value={value.name ?? ""}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {errors?.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
      </div>

      <div>
        <label htmlFor="org-industry" className="mb-1 block text-sm font-medium text-gray-700">
          Industry
        </label>
        <select
          id="org-industry"
          value={value.industry ?? ""}
          onChange={(e) => onChange({ ...value, industry: e.target.value as OrgBasicsInput["industry"] })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Select industry
          </option>
          {INDUSTRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors?.industry && <p className="mt-1 text-sm text-red-600">{errors.industry}</p>}
      </div>

      <div>
        <label htmlFor="fleet-size" className="mb-1 block text-sm font-medium text-gray-700">
          Fleet size
        </label>
        <select
          id="fleet-size"
          value={value.fleetSize ?? ""}
          onChange={(e) => onChange({ ...value, fleetSize: e.target.value as OrgBasicsInput["fleetSize"] })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Select fleet size
          </option>
          {FLEET_SIZE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {errors?.fleetSize && <p className="mt-1 text-sm text-red-600">{errors.fleetSize}</p>}
      </div>
    </div>
  );
}
