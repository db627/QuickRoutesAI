# Organization Setup Wizard — Design

**Date:** 2026-04-19
**Feature:** Multi-step onboarding wizard for new business registration.
**Scope:** First of five features in the current batch. Later features (Org Settings, Manual Route Override, Predictive ETA, AI Insights Dashboard) depend on the org data model introduced here.

## Goal

Introduce a first-class "organization" concept to QuickRoutesAI. An admin who signs up should be forced through a guided wizard that collects org details, links them as the org's owner, and only then grants dashboard access. The wizard must be resumable across refreshes and must not leave partial orgs in Firestore.

## Acceptance Criteria (from ticket)

- 3+ step wizard with validation
- Org document created in Firestore on completion
- Admin user linked to org
- Success confirmation screen shown

## Decisions

1. **Entry point:** Post-signup redirect. After admin signup via the existing `/auth/signup` flow, the dashboard layout checks for `orgId` and redirects to `/onboarding` if missing.
2. **Data collected:** 3 steps — org basics (name, industry, fleet size) → address → admin profile (name, phone, timezone) → success screen.
3. **Admin linkage:** Only users with `role === "admin"` can run the wizard. Completing it sets `orgId` on the user doc and `ownerUid` on the new org doc. Non-admins without `orgId` see a "contact your admin" notice.
4. **State persistence:** Resume from last completed step. Draft state lives in `wizardProgress` on the user doc; deleted on successful finish.
5. **Writes:** API-mediated, matching the existing Express/Zod pattern. No client-direct Firestore writes.

## Data Model

### New collection: `orgs`

```ts
// packages/shared/src/types.ts — additions
export type OrgIndustry = "delivery" | "logistics" | "field_service" | "other";
export type FleetSizeBucket = "1-5" | "6-20" | "21-50" | "51-200" | "200+";

export interface OrgAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string; // ISO-3166 alpha-2, default "US"
}

export interface Org {
  id: string;
  name: string;
  industry: OrgIndustry;
  fleetSize: FleetSizeBucket;
  address: OrgAddress;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
}
```

### Additions to `UserProfile`

```ts
export interface UserProfile {
  // ...existing fields unchanged
  orgId?: string;
  phone?: string;
  timezone?: string; // IANA, e.g. "America/New_York"
  wizardProgress?: WizardProgress;
}

export interface WizardProgress {
  currentStep: 1 | 2 | 3;
  data: {
    orgBasics?: { name: string; industry: OrgIndustry; fleetSize: FleetSizeBucket };
    address?: OrgAddress;
    adminProfile?: { name: string; phone: string; timezone: string };
  };
  updatedAt: string;
}
```

**Rationale:**
- `orgId` is optional so legacy users (created before this feature) don't break. Legacy admins will be funneled through the wizard on next login.
- `industry` and `fleetSize` are enums for clean segmentation later.
- `ownerUid` on the org duplicates with `orgId` on the user so queries work both directions.
- `wizardProgress` lives on the user doc (1:1 with the user, deleted on finish) — no orphan cleanup logic needed.

## API Surface

### New Zod schemas in `packages/shared/src/schemas.ts`

```ts
export const orgAddressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  zip: z.string().min(1).max(20),
  country: z.string().length(2).default("US"),
});

export const orgBasicsSchema = z.object({
  name: z.string().min(1).max(120),
  industry: z.enum(["delivery", "logistics", "field_service", "other"]),
  fleetSize: z.enum(["1-5", "6-20", "21-50", "51-200", "200+"]),
});

export const adminProfileSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(7).max(20),
  timezone: z.string().min(1).max(64),
});

export const wizardProgressSchema = z.object({
  currentStep: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  data: z.object({
    orgBasics: orgBasicsSchema.optional(),
    address: orgAddressSchema.optional(),
    adminProfile: adminProfileSchema.optional(),
  }),
});

export const createOrgSchema = z.object({
  orgBasics: orgBasicsSchema,
  address: orgAddressSchema,
  adminProfile: adminProfileSchema,
});
```

### New middleware: `requireRole`

Added to `apps/api/src/middleware/auth.ts`. Reads `users/{uid}` once, checks role against an allowlist, 403s otherwise. Reused by every write endpoint introduced in this and later features.

```ts
export function requireRole(...roles: UserRole[]): RequestHandler {
  return async (req, res, next) => {
    const snap = await db.collection("users").doc(req.uid).get();
    const role = snap.data()?.role as UserRole | undefined;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: "Forbidden", message: "Admin role required" });
    }
    next();
  };
}
```

### Route placement — follows existing `/prefix → routes/prefix.ts` convention

**Additions to `apps/api/src/routes/me.ts`** (already mounted at `/me` with `verifyFirebaseToken`):

| Endpoint | Handler middleware | Purpose |
|---|---|---|
| `GET /me/wizard-progress` | `requireRole("admin")` | Returns current `wizardProgress` or `null`. |
| `PATCH /me/wizard-progress` | `requireRole("admin")` + `validate(wizardProgressSchema)` | Saves one step's draft. Writes to `users/{uid}.wizardProgress`. Returns 204. |

`requireRole` is applied per-handler, not at the router level, because the existing `GET /me` must remain accessible to all authenticated roles.

**New route file `apps/api/src/routes/orgs.ts`**, mounted at `/orgs` in `apps/api/src/index.ts` with `verifyFirebaseToken`:

| Endpoint | Handler middleware | Purpose |
|---|---|---|
| `POST /orgs` | `requireRole("admin")` + `validate(createOrgSchema)` | Final atomic create. Firestore transaction: (a) reads user doc and aborts with 409 if `orgId` already set, (b) creates `orgs/{newId}` with `ownerUid = uid`, (c) patches `users/{uid}` with `orgId`, `name`, `phone`, `timezone`, and deletes `wizardProgress`. Returns `{ org, user }`. |

## Web UI Flow

### New route: `apps/web/app/onboarding/page.tsx`

Lives outside the `/dashboard` tree so dashboard chrome doesn't render over the wizard.

### Auth context changes

`apps/web/lib/auth-context.tsx` — augment `useAuth()`:
- Expose `orgId: string | null` alongside `role` (fetched from the same user doc read in the existing `onAuthStateChanged` handler).
- Expose `refresh(): Promise<void>` that re-reads `users/{uid}` and updates `role` + `orgId` state. Called from `onboarding/page.tsx` after a successful `POST /orgs` so the dashboard gate sees the new `orgId` without requiring a full page reload.

### Redirect gate

`apps/web/app/dashboard/layout.tsx`:
- `role === "admin" && !orgId` → `router.replace("/onboarding")`
- `role !== "admin" && !orgId` → render `<NoOrgNotice />` ("Ask your admin to finish setup")
- otherwise → render children

### Component structure

```
apps/web/app/onboarding/
  page.tsx                  # Orchestrator: loads wizardProgress, manages step state, handles submit
  components/
    WizardShell.tsx         # Step indicator (1/2/3), card frame, Next/Back buttons
    Step1OrgBasics.tsx
    Step2Address.tsx
    Step3AdminProfile.tsx
    SuccessScreen.tsx
    NoOrgNotice.tsx         # Used in dashboard/layout for non-admins without orgId
```

### Flow

1. **Mount:** `GET /me/wizard-progress`. If returned, set `currentStep` and prefill form data. Otherwise start at step 1. Step 3 prefills `name` from the user doc.
2. **On Next:** validate step with its Zod schema (client-side via `safeParse`). On success, `PATCH /me/wizard-progress` with `{ currentStep: nextStep, data: mergedData }`, then advance.
3. **On Back:** no API call, decrement local step.
4. **On Finish (step 3 Next):** `POST /orgs` with the merged `createOrgSchema` payload. On success, call `refresh()` from `useAuth()` so the context's `orgId` is populated, then render `<SuccessScreen />` with a button that navigates to `/dashboard` (which now passes the layout gate).

### Styling

Reuses existing Tailwind tokens. Uses the existing `toast-context.tsx` for transient notifications. No new UI libraries.

## Error Handling & Edge Cases

### Per-step validation failures (client)

Each step runs `zodSchema.safeParse(formData)` on Next click. Field errors render inline. Next is disabled while errors exist. No API call fires.

### `PATCH /me/wizard-progress` failures

Non-blocking for UX. Toast "Couldn't save progress — you can keep going" and allow advancing. The final `POST /orgs` carries the complete payload anyway, so a failed draft save only breaks resume-on-refresh for one step. 401 (token expired) is the exception — redirect to `/login`.

### `POST /orgs` failures

- **400 validation** → map `details[].path` to the relevant step and jump back.
- **409 (user already has orgId)** → another tab finished first. Toast "Your organization is already set up" and redirect to `/dashboard`.
- **403 (non-admin)** → toast "Admin role required" and redirect to `/dashboard`. Defense in depth; shouldn't be reachable via the gate.
- **5xx** → inline error on the final step with Retry button. In-memory form data is preserved.

### Transaction atomicity

`POST /orgs` runs inside a Firestore transaction:
1. Re-read the user doc.
2. Abort with 409 if `orgId` is set (closes double-submit race across tabs).
3. Create the org with auto-ID, `ownerUid = uid`.
4. Patch the user: set `orgId`, `name`, `phone`, `timezone`; `FieldValue.delete()` on `wizardProgress`.

### Edge cases

- **Two tabs open, both finish.** Transaction's 409 check guarantees exactly one succeeds.
- **Browser closed mid-wizard.** Next login → layout gate → `/onboarding` → `GET /me/wizard-progress` → resume.
- **Admin navigates directly to `/dashboard/trips`.** Layout gate redirects to `/onboarding`. The gate runs in the layout so it covers every nested route.
- **Driver/dispatcher navigates to `/onboarding`.** Page-level check redirects to `/dashboard`. API 403 is the authoritative enforcement.
- **Legacy users without `orgId`.** If they're admins, they'll be funneled through the wizard on next login. Acceptable for now; if it becomes a problem for seeded test users, we can add a `legacyNoOrg: true` bypass flag. Not built now.

## Testing

### API tests — `apps/api/src/__tests__/routes/orgs.test.ts`

Uses the Firestore emulator (existing pattern from `trips.test.ts`).

**`PATCH /me/wizard-progress`**
- 401 without auth
- 403 when role is `driver` or `dispatcher`
- 204 writes `wizardProgress` with the exact shape sent
- 400 on schema violation (`currentStep: 4`, missing required field)

**`GET /me/wizard-progress`**
- Returns `null` when not set
- Returns saved progress verbatim

**`POST /orgs`**
- 403 for non-admins
- Happy path: creates org, patches user, deletes `wizardProgress`, returns `{ org, user }`
- 409 when user already has `orgId`
- 400 when payload fails `createOrgSchema`
- Transaction atomicity: force mid-transaction failure and assert neither org created nor user partially updated

### Middleware test — `apps/api/src/__tests__/middleware/requireRole.test.ts`

- Allows when role matches
- 403 when role mismatches
- 403 when user doc missing

### Shared schema tests — extend `packages/shared/src/__tests__/schemas.test.ts`

Parse/fail cases for `orgBasicsSchema`, `orgAddressSchema`, `adminProfileSchema`, `wizardProgressSchema`, `createOrgSchema`.

### Web tests — `apps/web/__tests__/onboarding/`

- `page.test.tsx` — renders step 1 when no `wizardProgress`; resumes at step 2 when `GET` returns step 2 data; calls `PATCH` on Next; calls `POST /orgs` on final Next and renders `<SuccessScreen />`.
- `WizardShell.test.tsx` — step indicator highlights active step; Back disabled on step 1.
- `Step3AdminProfile.test.tsx` — timezone select populated; invalid phone shows inline error.
- `layout.test.tsx` (dashboard) — admin without `orgId` redirects to `/onboarding`; driver without `orgId` renders `<NoOrgNotice />`; admin with `orgId` renders children.

Mocks follow existing web test patterns: `jest.mock("@/lib/api")`, `jest.mock("next/navigation")`.

### Out of scope

No visual regression, no E2E (Playwright/Cypress), no performance testing — none are set up in this repo.

## Out of Scope for This Feature

- Editing the org after creation (handled by the Org Settings Page — feature #2 in the batch).
- Inviting teammates during onboarding (deferred; no invite feature exists yet).
- Multi-org support for a single user (single-org assumption documented in data model).
- Migration for legacy admins without `orgId` (noted as a follow-up).
