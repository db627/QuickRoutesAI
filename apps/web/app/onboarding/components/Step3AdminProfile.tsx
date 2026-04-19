"use client";

import { adminProfileSchema, type AdminProfileInput } from "@quickroutesai/shared";

interface Step3Props {
  value: Partial<AdminProfileInput>;
  onChange: (next: Partial<AdminProfileInput>) => void;
  errors?: Partial<Record<keyof AdminProfileInput, string>>;
}

export function validateStep3(value: Partial<AdminProfileInput>) {
  return adminProfileSchema.safeParse(value);
}

function getTimezones(): string[] {
  // @ts-expect-error — supportedValuesOf exists on modern runtimes
  const list: string[] | undefined = typeof Intl.supportedValuesOf === "function"
    ? (Intl as any).supportedValuesOf("timeZone")
    : undefined;
  if (list && list.length > 0) return list;
  // Minimal fallback list for test/legacy environments
  return [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "UTC",
  ];
}

export default function Step3AdminProfile({ value, onChange, errors }: Step3Props) {
  const timezones = getTimezones();
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="admin-name" className="mb-1 block text-sm font-medium text-gray-700">
          Your name
        </label>
        <input
          id="admin-name"
          type="text"
          value={value.name ?? ""}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {errors?.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
      </div>

      <div>
        <label htmlFor="admin-phone" className="mb-1 block text-sm font-medium text-gray-700">
          Phone
        </label>
        <input
          id="admin-phone"
          type="tel"
          value={value.phone ?? ""}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {errors?.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
      </div>

      <div>
        <label htmlFor="admin-tz" className="mb-1 block text-sm font-medium text-gray-700">
          Timezone
        </label>
        <select
          id="admin-tz"
          value={value.timezone ?? ""}
          onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Select timezone
          </option>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {errors?.timezone && <p className="mt-1 text-sm text-red-600">{errors.timezone}</p>}
      </div>
    </div>
  );
}
