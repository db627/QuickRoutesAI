"use client";

import { orgAddressSchema, type OrgAddressInput } from "@quickroutesai/shared";

interface Step2Props {
  value: Partial<OrgAddressInput>;
  onChange: (next: Partial<OrgAddressInput>) => void;
  errors?: Partial<Record<keyof OrgAddressInput, string>>;
}

export function validateStep2(value: Partial<OrgAddressInput>) {
  return orgAddressSchema.safeParse(value);
}

const FIELDS: { key: keyof OrgAddressInput; label: string }[] = [
  { key: "street", label: "Street" },
  { key: "city", label: "City" },
  { key: "state", label: "State / Region" },
  { key: "zip", label: "ZIP / Postal code" },
  { key: "country", label: "Country (ISO-3166 alpha-2, e.g. US)" },
];

export default function Step2Address({ value, onChange, errors }: Step2Props) {
  return (
    <div className="space-y-4">
      {FIELDS.map((f) => (
        <div key={f.key}>
          <label htmlFor={`addr-${f.key}`} className="mb-1 block text-sm font-medium text-gray-700">
            {f.label}
          </label>
          <input
            id={`addr-${f.key}`}
            type="text"
            value={(value[f.key] as string | undefined) ?? (f.key === "country" ? "US" : "")}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            maxLength={f.key === "country" ? 2 : undefined}
          />
          {errors?.[f.key] && <p className="mt-1 text-sm text-red-600">{errors[f.key]}</p>}
        </div>
      ))}
    </div>
  );
}
