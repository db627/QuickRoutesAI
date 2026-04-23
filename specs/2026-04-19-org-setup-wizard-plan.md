# Organization Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 3-step onboarding wizard that forces new admins to create their organization and link themselves before accessing the dashboard, with resume-on-refresh and atomic final submit.

**Architecture:** New `orgs` Firestore collection with `ownerUid` back-reference; new `orgId`/`wizardProgress`/`phone`/`timezone` fields on `UserProfile`. Three new Express endpoints (`GET`/`PATCH /me/wizard-progress`, `POST /orgs`). New Next.js `/onboarding` route gated by a redirect in `dashboard/layout.tsx`. Final submit runs in a Firestore transaction that refuses to create a second org for the same user.

**Tech Stack:** Express + Firebase Admin SDK + Zod (api); Next.js 14 app router + Firebase Web SDK + Tailwind + Jest + React Testing Library (web); TypeScript throughout.

**Spec:** `specs/2026-04-19-org-setup-wizard-design.md`

**Spec corrections discovered during planning:**
- `requireRole` middleware already exists at `apps/api/src/middleware/auth.ts:60` and reads `req.userRole` (set by `verifyFirebaseToken`). No new middleware needed.
- Errors use `next(new AppError(ErrorCode.X, status, message))`, not raw `res.status().json()`.
- Tests mock `../../config/firebase` via `jest.mock`, not a Firestore emulator.
- Shared schema tests live in `apps/api/src/__tests__/schemas.test.ts` (extended), not in `packages/shared/src/__tests__/`.

---

## File Structure

### New files

**Shared package**
- None. Types and schemas are added to existing files.

**API**
- `apps/api/src/routes/orgs.ts` — `POST /orgs` route file (mounted at `/orgs`).
- `apps/api/src/__tests__/orgs.test.ts` — tests for `POST /orgs`.
- `apps/api/src/__tests__/me.wizard.test.ts` — tests for `GET`/`PATCH /me/wizard-progress`.

**Web**
- `apps/web/app/onboarding/page.tsx` — wizard orchestrator (client component).
- `apps/web/app/onboarding/components/WizardShell.tsx` — step indicator + Next/Back chrome.
- `apps/web/app/onboarding/components/Step1OrgBasics.tsx`
- `apps/web/app/onboarding/components/Step2Address.tsx`
- `apps/web/app/onboarding/components/Step3AdminProfile.tsx`
- `apps/web/app/onboarding/components/SuccessScreen.tsx`
- `apps/web/components/NoOrgNotice.tsx` — shown to non-admins without `orgId`.
- `apps/web/__tests__/app/onboarding.test.tsx` — integration test for the wizard.

### Modified files

- `packages/shared/src/types.ts` — add `Org`, `OrgAddress`, `OrgIndustry`, `FleetSizeBucket`, `WizardProgress`; extend `UserProfile`.
- `packages/shared/src/schemas.ts` — add `orgAddressSchema`, `orgBasicsSchema`, `adminProfileSchema`, `wizardProgressSchema`, `createOrgSchema`.
- `apps/api/src/routes/me.ts` — add `GET /wizard-progress` and `PATCH /wizard-progress` handlers.
- `apps/api/src/index.ts` — mount `/orgs` router.
- `apps/api/src/__tests__/helpers/setup.ts` — mount `orgsRoutes` in `createTestApp`.
- `apps/api/src/__tests__/schemas.test.ts` — add tests for new schemas.
- `apps/web/lib/auth-context.tsx` — expose `orgId` and `refresh()`.
- `apps/web/app/dashboard/layout.tsx` — add redirect gate (admin w/o org → `/onboarding`; non-admin w/o org → `<NoOrgNotice />`).
- `apps/web/__tests__/app/dashboard-layout.test.tsx` — add tests for the new gate.

---

## Task 1: Add shared types for Org, UserProfile extensions, and WizardProgress

**Files:**
- Modify: `packages/shared/src/types.ts` (append to end of file)

- [ ] **Step 1: Add the new types**

Append to `packages/shared/src/types.ts`:

```ts
// ── Organization ──
export type OrgIndustry = "delivery" | "logistics" | "field_service" | "other";
export type FleetSizeBucket = "1-5" | "6-20" | "21-50" | "51-200" | "200+";

export interface OrgAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string; // ISO-3166 alpha-2
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

// ── Wizard ──
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

Then extend the existing `UserProfile` interface in the same file by adding these fields (do NOT duplicate the interface — edit the existing one):

```ts
// Within the existing UserProfile interface, add these optional fields:
  orgId?: string;
  phone?: string;
  timezone?: string;
  wizardProgress?: WizardProgress;
```

- [ ] **Step 2: Verify types compile**

Run:
```bash
pnpm --filter @quickroutesai/shared build
```

Expected: build succeeds, `packages/shared/dist/` regenerated.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add Org, OrgAddress, WizardProgress types"
```

---

## Task 2: Add shared Zod schemas

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append at end)
- Test: `apps/api/src/__tests__/schemas.test.ts` (append)

- [ ] **Step 1: Write the failing schema tests**

Append to `apps/api/src/__tests__/schemas.test.ts`:

```ts
import {
  orgAddressSchema,
  orgBasicsSchema,
  adminProfileSchema,
  wizardProgressSchema,
  createOrgSchema,
} from "@quickroutesai/shared";

describe("orgAddressSchema", () => {
  it("accepts a valid address", () => {
    const r = orgAddressSchema.safeParse({
      street: "1 Main St",
      city: "Boston",
      state: "MA",
      zip: "02101",
      country: "US",
    });
    expect(r.success).toBe(true);
  });

  it("defaults country to US", () => {
    const r = orgAddressSchema.safeParse({
      street: "1 Main St",
      city: "Boston",
      state: "MA",
      zip: "02101",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.country).toBe("US");
  });

  it("rejects empty street", () => {
    const r = orgAddressSchema.safeParse({
      street: "",
      city: "Boston",
      state: "MA",
      zip: "02101",
    });
    expect(r.success).toBe(false);
  });
});

describe("orgBasicsSchema", () => {
  it("accepts a valid payload", () => {
    const r = orgBasicsSchema.safeParse({
      name: "Acme Delivery",
      industry: "delivery",
      fleetSize: "6-20",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown industry", () => {
    const r = orgBasicsSchema.safeParse({
      name: "Acme",
      industry: "banking",
      fleetSize: "6-20",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fleetSize bucket", () => {
    const r = orgBasicsSchema.safeParse({
      name: "Acme",
      industry: "delivery",
      fleetSize: "1000",
    });
    expect(r.success).toBe(false);
  });
});

describe("adminProfileSchema", () => {
  it("accepts a valid profile", () => {
    const r = adminProfileSchema.safeParse({
      name: "Alice",
      phone: "555-1234",
      timezone: "America/New_York",
    });
    expect(r.success).toBe(true);
  });

  it("rejects short phone", () => {
    const r = adminProfileSchema.safeParse({
      name: "Alice",
      phone: "12",
      timezone: "America/New_York",
    });
    expect(r.success).toBe(false);
  });
});

describe("wizardProgressSchema", () => {
  it("accepts step 1 with only orgBasics", () => {
    const r = wizardProgressSchema.safeParse({
      currentStep: 1,
      data: {
        orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects currentStep out of range", () => {
    const r = wizardProgressSchema.safeParse({
      currentStep: 4,
      data: {},
    });
    expect(r.success).toBe(false);
  });
});

describe("createOrgSchema", () => {
  it("accepts a complete payload", () => {
    const r = createOrgSchema.safeParse({
      orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      address: {
        street: "1 Main St",
        city: "Boston",
        state: "MA",
        zip: "02101",
        country: "US",
      },
      adminProfile: {
        name: "Alice",
        phone: "555-1234",
        timezone: "America/New_York",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects when address is missing", () => {
    const r = createOrgSchema.safeParse({
      orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      adminProfile: {
        name: "Alice",
        phone: "555-1234",
        timezone: "America/New_York",
      },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
pnpm --filter @quickroutesai/api test -- schemas.test.ts
```

Expected: compilation errors (`orgAddressSchema` etc. do not exist).

- [ ] **Step 3: Implement the schemas**

Append to `packages/shared/src/schemas.ts`:

```ts
// ── Organization ──
export const orgAddressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  zip: z.string().min(1).max(20),
  country: z.string().length(2).default("US"),
});
export type OrgAddressInput = z.infer<typeof orgAddressSchema>;

export const orgBasicsSchema = z.object({
  name: z.string().min(1).max(120),
  industry: z.enum(["delivery", "logistics", "field_service", "other"]),
  fleetSize: z.enum(["1-5", "6-20", "21-50", "51-200", "200+"]),
});
export type OrgBasicsInput = z.infer<typeof orgBasicsSchema>;

export const adminProfileSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(7).max(20),
  timezone: z.string().min(1).max(64),
});
export type AdminProfileInput = z.infer<typeof adminProfileSchema>;

export const wizardProgressSchema = z.object({
  currentStep: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  data: z.object({
    orgBasics: orgBasicsSchema.optional(),
    address: orgAddressSchema.optional(),
    adminProfile: adminProfileSchema.optional(),
  }),
});
export type WizardProgressInput = z.infer<typeof wizardProgressSchema>;

export const createOrgSchema = z.object({
  orgBasics: orgBasicsSchema,
  address: orgAddressSchema,
  adminProfile: adminProfileSchema,
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;
```

- [ ] **Step 4: Rebuild shared**

Run:
```bash
pnpm --filter @quickroutesai/shared build
```

Expected: build succeeds.

- [ ] **Step 5: Run schema tests to verify they pass**

Run:
```bash
pnpm --filter @quickroutesai/api test -- schemas.test.ts
```

Expected: all new describe blocks pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/__tests__/schemas.test.ts
git commit -m "feat(shared): add org/wizard Zod schemas"
```

---

## Task 3: Add `PATCH /me/wizard-progress` and `GET /me/wizard-progress` endpoints

**Files:**
- Modify: `apps/api/src/routes/me.ts`
- Test: `apps/api/src/__tests__/me.wizard.test.ts`
- Modify: `apps/api/src/__tests__/helpers/setup.ts` (verified — no change needed; `/me` is already mounted)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/__tests__/me.wizard.test.ts`:

```ts
import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();
const { db } = require("../config/firebase");

beforeEach(() => {
  jest.clearAllMocks();
});

function mockUsersCollection(handlers: {
  uid: string;
  role: string;
  wizardProgress?: any;
  update?: jest.Mock;
}) {
  const update = handlers.update ?? jest.fn().mockResolvedValue(undefined);
  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: (_id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              role: handlers.role,
              ...(handlers.wizardProgress !== undefined
                ? { wizardProgress: handlers.wizardProgress }
                : {}),
            }),
          }),
          update,
          set: jest.fn(),
        }),
      };
    }
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false }),
    };
  });
  return { update };
}

describe("GET /me/wizard-progress", () => {
  it("returns null when no progress is saved", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockUsersCollection({ uid, role: "admin" });

    const res = await request(app)
      .get("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wizardProgress: null });
  });

  it("returns saved progress", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    const progress = {
      currentStep: 2,
      data: {
        orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      },
      updatedAt: "2026-04-19T00:00:00.000Z",
    };
    mockUsersCollection({ uid, role: "admin", wizardProgress: progress });

    const res = await request(app)
      .get("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(200);
    expect(res.body.wizardProgress).toEqual(progress);
  });

  it("403 for non-admin", async () => {
    const uid = "driver-1";
    setupMockUser(uid, "driver");
    mockUsersCollection({ uid, role: "driver" });

    const res = await request(app)
      .get("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(403);
  });
});

describe("PATCH /me/wizard-progress", () => {
  it("writes wizardProgress and returns 204", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    const { update } = mockUsersCollection({ uid, role: "admin" });

    const body = {
      currentStep: 1,
      data: {
        orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      },
    };

    const res = await request(app)
      .patch("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token")
      .send(body);

    expect(res.status).toBe(204);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        wizardProgress: expect.objectContaining({
          currentStep: 1,
          data: body.data,
          updatedAt: expect.any(String),
        }),
      }),
    );
  });

  it("400 when currentStep is invalid", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockUsersCollection({ uid, role: "admin" });

    const res = await request(app)
      .patch("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token")
      .send({ currentStep: 4, data: {} });

    expect(res.status).toBe(400);
  });

  it("403 for non-admin", async () => {
    const uid = "disp-1";
    setupMockUser(uid, "dispatcher");
    mockUsersCollection({ uid, role: "dispatcher" });

    const res = await request(app)
      .patch("/me/wizard-progress")
      .set("Authorization", "Bearer fake-token")
      .send({ currentStep: 1, data: {} });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @quickroutesai/api test -- me.wizard.test.ts
```

Expected: FAIL — routes `GET /me/wizard-progress` and `PATCH /me/wizard-progress` return 404 or undefined behavior.

- [ ] **Step 3: Implement the handlers**

Replace the contents of `apps/api/src/routes/me.ts` with:

```ts
import { Router } from "express";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { wizardProgressSchema } from "@quickroutesai/shared";

const router = Router();

/**
 * GET /me — returns the authenticated user's profile + role
 */
router.get("/", async (req, res) => {
  try {
    const userDoc = await db.collection("users").doc(req.uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "User profile not found" });
    }

    const data = userDoc.data();
    res.json({
      uid: req.uid,
      email: data?.email || req.userEmail,
      name: data?.name || "",
      role: data?.role || "driver",
      orgId: data?.orgId ?? null,
      phone: data?.phone ?? null,
      timezone: data?.timezone ?? null,
      createdAt: data?.createdAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch profile" });
  }
});

/**
 * GET /me/wizard-progress — returns saved wizard state or null.
 * Admin only.
 */
router.get("/wizard-progress", requireRole("admin"), async (req, res) => {
  try {
    const userDoc = await db.collection("users").doc(req.uid).get();
    const progress = userDoc.exists ? userDoc.data()?.wizardProgress ?? null : null;
    res.json({ wizardProgress: progress });
  } catch (err) {
    res.status(500).json({ error: "Internal Error", message: "Failed to fetch wizard progress" });
  }
});

/**
 * PATCH /me/wizard-progress — saves wizard draft state for one step.
 * Admin only.
 */
router.patch(
  "/wizard-progress",
  requireRole("admin"),
  validate(wizardProgressSchema),
  async (req, res) => {
    try {
      await db.collection("users").doc(req.uid).update({
        wizardProgress: {
          currentStep: req.body.currentStep,
          data: req.body.data,
          updatedAt: new Date().toISOString(),
        },
      });
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: "Internal Error", message: "Failed to save wizard progress" });
    }
  },
);

export default router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm --filter @quickroutesai/api test -- me.wizard.test.ts
```

Expected: all 6 test cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me.ts apps/api/src/__tests__/me.wizard.test.ts
git commit -m "feat(api): add GET/PATCH /me/wizard-progress endpoints"
```

---

## Task 4: Add `POST /orgs` endpoint with atomic transaction

**Files:**
- Create: `apps/api/src/routes/orgs.ts`
- Create: `apps/api/src/__tests__/orgs.test.ts`
- Modify: `apps/api/src/index.ts` (mount `/orgs`)
- Modify: `apps/api/src/__tests__/helpers/setup.ts` (mount `/orgs` in test app)

- [ ] **Step 1: Mount the route in the production app**

Edit `apps/api/src/index.ts`. Add import near existing route imports:

```ts
import orgRoutes from "./routes/orgs";
```

Add mount near existing protected routes:

```ts
app.use("/orgs", verifyFirebaseToken, orgRoutes);
```

- [ ] **Step 2: Mount the route in the test app**

Edit `apps/api/src/__tests__/helpers/setup.ts`. Add import near the other route imports at the top:

```ts
import orgRoutes from "../../routes/orgs";
```

Add mount in `createTestApp` next to the other protected routes:

```ts
app.use("/orgs", verifyFirebaseToken, orgRoutes);
```

Note: this will fail compilation until Step 4 creates the route file. That's expected — we'll fix the test first.

- [ ] **Step 3: Write the failing tests**

Create `apps/api/src/__tests__/orgs.test.ts`:

```ts
import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

const app = createTestApp();
const { db } = require("../config/firebase");

beforeEach(() => {
  jest.clearAllMocks();
});

const validPayload = {
  orgBasics: { name: "Acme Delivery", industry: "delivery", fleetSize: "6-20" },
  address: {
    street: "1 Main St",
    city: "Boston",
    state: "MA",
    zip: "02101",
    country: "US",
  },
  adminProfile: {
    name: "Alice Admin",
    phone: "555-123-4567",
    timezone: "America/New_York",
  },
};

/**
 * Mock helper: wires up Firestore so that `users/{uid}` behaves like a doc
 * with the given role / orgId, and `db.runTransaction` executes the callback
 * immediately with a transaction object that uses the same doc mock.
 */
function mockTransactionalOrgCreate(opts: {
  uid: string;
  role: string;
  existingOrgId?: string | null;
}) {
  const userDocRef = { id: opts.uid };
  const txGet = jest.fn().mockResolvedValue({
    exists: true,
    data: () => ({
      role: opts.role,
      ...(opts.existingOrgId ? { orgId: opts.existingOrgId } : {}),
    }),
  });
  const txUpdate = jest.fn();
  const txSet = jest.fn();

  const orgDocRef = { id: "new-org-id-abc" };
  const orgDocCreator = jest.fn().mockReturnValue(orgDocRef);

  db.runTransaction = jest.fn(async (fn: any) => {
    return fn({
      get: txGet,
      update: txUpdate,
      set: txSet,
    });
  });

  db.collection.mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: (_id: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              role: opts.role,
              ...(opts.existingOrgId ? { orgId: opts.existingOrgId } : {}),
            }),
          }),
          // Returned reference for use inside the transaction
          ...userDocRef,
        }),
      };
    }
    if (col === "orgs") {
      return {
        doc: orgDocCreator,
      };
    }
    return {
      doc: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ exists: false }),
    };
  });

  return { txGet, txUpdate, txSet, orgDocCreator };
}

describe("POST /orgs", () => {
  it("403 for non-admin", async () => {
    const uid = "disp-1";
    setupMockUser(uid, "dispatcher");
    mockTransactionalOrgCreate({ uid, role: "dispatcher" });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send(validPayload);

    expect(res.status).toBe(403);
  });

  it("400 when payload is invalid", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockTransactionalOrgCreate({ uid, role: "admin" });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send({ ...validPayload, orgBasics: { name: "", industry: "delivery", fleetSize: "6-20" } });

    expect(res.status).toBe(400);
  });

  it("happy path: creates org, patches user, returns org+user", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    const { txGet, txUpdate, txSet, orgDocCreator } = mockTransactionalOrgCreate({
      uid,
      role: "admin",
    });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.org).toMatchObject({
      id: "new-org-id-abc",
      name: "Acme Delivery",
      industry: "delivery",
      fleetSize: "6-20",
      address: validPayload.address,
      ownerUid: uid,
    });
    expect(res.body.user).toMatchObject({
      uid,
      orgId: "new-org-id-abc",
      name: "Alice Admin",
      phone: "555-123-4567",
      timezone: "America/New_York",
    });

    expect(txGet).toHaveBeenCalled();
    expect(orgDocCreator).toHaveBeenCalled(); // auto-id doc ref
    expect(txSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-org-id-abc" }),
      expect.objectContaining({
        name: "Acme Delivery",
        ownerUid: uid,
      }),
    );
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: uid }),
      expect.objectContaining({
        orgId: "new-org-id-abc",
        name: "Alice Admin",
        phone: "555-123-4567",
        timezone: "America/New_York",
        wizardProgress: expect.anything(), // FieldValue.delete() sentinel
      }),
    );
  });

  it("409 when the user already has an orgId", async () => {
    const uid = "admin-1";
    setupMockUser(uid, "admin");
    mockTransactionalOrgCreate({
      uid,
      role: "admin",
      existingOrgId: "existing-org",
    });

    const res = await request(app)
      .post("/orgs")
      .set("Authorization", "Bearer fake-token")
      .send(validPayload);

    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail with a missing-module error**

Run:
```bash
pnpm --filter @quickroutesai/api test -- orgs.test.ts
```

Expected: FAIL — `Cannot find module '../../routes/orgs'` (because the import in the test helper refers to a file we haven't created yet).

- [ ] **Step 5: Create the route file**

Create `apps/api/src/routes/orgs.ts`:

```ts
import { Router } from "express";
import admin from "firebase-admin";
import { db } from "../config/firebase";
import { requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createOrgSchema, ErrorCode } from "@quickroutesai/shared";
import { AppError } from "../utils/AppError";

const router = Router();

/**
 * POST /orgs — create an organization and link the current admin to it.
 *
 * Runs in a Firestore transaction:
 *   1. Re-read the user doc inside the transaction.
 *   2. Abort with 409 if the user already has an orgId.
 *   3. Create orgs/{newId} with ownerUid = req.uid.
 *   4. Patch users/{uid}: set orgId, name, phone, timezone; delete wizardProgress.
 *
 * Admin only.
 */
router.post(
  "/",
  requireRole("admin"),
  validate(createOrgSchema),
  async (req, res, next) => {
    const now = new Date().toISOString();
    const { orgBasics, address, adminProfile } = req.body;

    try {
      const userRef = db.collection("users").doc(req.uid);
      const orgRef = db.collection("orgs").doc();

      const org = {
        id: orgRef.id,
        name: orgBasics.name,
        industry: orgBasics.industry,
        fleetSize: orgBasics.fleetSize,
        address,
        ownerUid: req.uid,
        createdAt: now,
        updatedAt: now,
      };

      const userPatch = {
        orgId: orgRef.id,
        name: adminProfile.name,
        phone: adminProfile.phone,
        timezone: adminProfile.timezone,
        wizardProgress: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      };

      let conflict = false;

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (snap.exists && snap.data()?.orgId) {
          conflict = true;
          return;
        }
        tx.set(orgRef, org);
        tx.update(userRef, userPatch);
      });

      if (conflict) {
        return next(new AppError(ErrorCode.CONFLICT, 409, "User already belongs to an organization"));
      }

      res.status(201).json({
        org,
        user: {
          uid: req.uid,
          orgId: orgRef.id,
          name: adminProfile.name,
          phone: adminProfile.phone,
          timezone: adminProfile.timezone,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
pnpm --filter @quickroutesai/api test -- orgs.test.ts me.wizard.test.ts
```

Expected: all tests in both files pass. No other test files are affected.

- [ ] **Step 7: Run the full API test suite to confirm no regressions**

Run:
```bash
pnpm --filter @quickroutesai/api test
```

Expected: every test passes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/orgs.ts apps/api/src/index.ts apps/api/src/__tests__/orgs.test.ts apps/api/src/__tests__/helpers/setup.ts
git commit -m "feat(api): add POST /orgs with atomic transaction"
```

---

## Task 5: Extend `useAuth()` to expose `orgId` and `refresh()`

**Files:**
- Modify: `apps/web/lib/auth-context.tsx`

- [ ] **Step 1: Replace the file contents**

Replace `apps/web/lib/auth-context.tsx` with:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, firestore } from "./firebase";
import type { UserRole } from "@quickroutesai/shared";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  orgId: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  role: null,
  orgId: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const readProfile = useCallback(async (firebaseUser: User) => {
    const userDoc = await getDoc(doc(firestore, "users", firebaseUser.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      setRole((data.role as UserRole) ?? null);
      setOrgId((data.orgId as string | undefined) ?? null);
    } else {
      setRole(null);
      setOrgId(null);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        await readProfile(firebaseUser);
      } else {
        setUser(null);
        setRole(null);
        setOrgId(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [readProfile]);

  const logout = async () => {
    await signOut(auth);
  };

  const refresh = useCallback(async () => {
    if (auth.currentUser) {
      await readProfile(auth.currentUser);
    }
  }, [readProfile]);

  return (
    <AuthContext.Provider value={{ user, role, orgId, loading, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

- [ ] **Step 2: Run the web type-checker to ensure existing consumers still compile**

Run:
```bash
pnpm --filter @quickroutesai/web exec tsc --noEmit
```

Expected: PASS. If any consumer was destructuring `useAuth()` and does not handle `orgId`/`refresh`, ignore it — those are additive.

- [ ] **Step 3: Run the existing dashboard-layout test to confirm the existing mock still works**

Run:
```bash
pnpm --filter @quickroutesai/web test -- dashboard-layout.test.tsx
```

Expected: PASS. The existing test mocks `useAuth` returning only `{ user, role, loading, logout }` — that's still a subset of the new shape, and TypeScript's lenient cast `as any` in the mock keeps it working.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/auth-context.tsx
git commit -m "feat(web): expose orgId and refresh() from useAuth"
```

---

## Task 6: Create `<NoOrgNotice />` component

**Files:**
- Create: `apps/web/components/NoOrgNotice.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/components/NoOrgNotice.tsx`:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/NoOrgNotice.tsx
git commit -m "feat(web): add NoOrgNotice component"
```

---

## Task 7: Dashboard layout redirect gate

**Files:**
- Modify: `apps/web/app/dashboard/layout.tsx`
- Modify: `apps/web/__tests__/app/dashboard-layout.test.tsx`

- [ ] **Step 1: Write the failing tests**

Edit `apps/web/__tests__/app/dashboard-layout.test.tsx`. Inside the existing `describe("DashboardLayout", () => { ... })` block, add three new tests after the existing ones:

```tsx
  it("redirects admin without orgId to /onboarding", () => {
    const replace = jest.fn();
    mockedUseRouter.mockReturnValue({ replace } as any);
    mockedUseAuth.mockReturnValue({
      user: { uid: "u1" } as never,
      role: "admin",
      orgId: null,
      loading: false,
      logout: jest.fn(),
      refresh: jest.fn(),
    } as any);

    render(
      <DashboardLayout>
        <div>child</div>
      </DashboardLayout>,
    );

    expect(replace).toHaveBeenCalledWith("/onboarding");
  });

  it("renders NoOrgNotice for non-admin without orgId", () => {
    mockedUseAuth.mockReturnValue({
      user: { uid: "u1" } as never,
      role: "driver",
      orgId: null,
      loading: false,
      logout: jest.fn(),
      refresh: jest.fn(),
    } as any);

    render(
      <DashboardLayout>
        <div data-testid="protected-child">child</div>
      </DashboardLayout>,
    );

    expect(screen.getByText(/Waiting for organization setup/i)).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("renders children when admin has orgId", () => {
    mockedUseAuth.mockReturnValue({
      user: { uid: "u1" } as never,
      role: "admin",
      orgId: "org-abc",
      loading: false,
      logout: jest.fn(),
      refresh: jest.fn(),
    } as any);

    render(
      <DashboardLayout>
        <div data-testid="protected-child">child</div>
      </DashboardLayout>,
    );

    expect(screen.getByTestId("protected-child")).toBeInTheDocument();
  });
```

The existing `beforeEach` sets `mockedUseAuth` with `admin` but no `orgId`, which will now trigger the redirect. Update the existing `beforeEach` default to include `orgId: "org-default"` and `refresh: jest.fn()` so pre-existing tests still pass:

```tsx
    mockedUseAuth.mockReturnValue({
      user: { uid: "u1" } as never,
      role: "admin",
      orgId: "org-default",
      loading: false,
      logout: jest.fn(),
      refresh: jest.fn(),
    } as any);
```

- [ ] **Step 2: Run tests to verify the new cases fail**

Run:
```bash
pnpm --filter @quickroutesai/web test -- dashboard-layout.test.tsx
```

Expected: the three new tests FAIL (redirect doesn't fire, NoOrgNotice doesn't render).

- [ ] **Step 3: Update the dashboard layout**

Replace the `useEffect` that currently handles only the `!user` case, and the render branch after `if (!user) return null;`, with logic that covers all three gate cases. The full file becomes:

```tsx
"use client";

import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import NoOrgNotice from "@/components/NoOrgNotice";

const HamburgerIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, role, orgId, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (role === "admin" && !orgId) {
      router.replace("/onboarding");
    }
  }, [user, role, orgId, loading, router]);

  // Close drawer whenever the route changes
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) return null;
  if (role === "admin" && !orgId) return null; // redirecting
  if (role !== "admin" && !orgId) return <NoOrgNotice />;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          aria-label="Open navigation menu"
        >
          <HamburgerIcon />
        </button>
        <span className="font-bold text-gray-900">QuickRoutesAI</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          role={role}
          onLogout={logout}
          isDrawerOpen={drawerOpen}
          onDrawerClose={() => setDrawerOpen(false)}
        />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they all pass**

Run:
```bash
pnpm --filter @quickroutesai/web test -- dashboard-layout.test.tsx
```

Expected: all tests in the file pass (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/layout.tsx apps/web/__tests__/app/dashboard-layout.test.tsx
git commit -m "feat(web): gate dashboard on orgId and redirect admins to /onboarding"
```

---

## Task 8: Wizard shell component

**Files:**
- Create: `apps/web/app/onboarding/components/WizardShell.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/app/onboarding/components/WizardShell.tsx`:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/onboarding/components/WizardShell.tsx
git commit -m "feat(web): add WizardShell component"
```

---

## Task 9: Step 1 — Org basics form

**Files:**
- Create: `apps/web/app/onboarding/components/Step1OrgBasics.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/app/onboarding/components/Step1OrgBasics.tsx`:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/onboarding/components/Step1OrgBasics.tsx
git commit -m "feat(web): add Step1OrgBasics form"
```

---

## Task 10: Step 2 — Address form

**Files:**
- Create: `apps/web/app/onboarding/components/Step2Address.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/app/onboarding/components/Step2Address.tsx`:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/onboarding/components/Step2Address.tsx
git commit -m "feat(web): add Step2Address form"
```

---

## Task 11: Step 3 — Admin profile form

**Files:**
- Create: `apps/web/app/onboarding/components/Step3AdminProfile.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/app/onboarding/components/Step3AdminProfile.tsx`:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/onboarding/components/Step3AdminProfile.tsx
git commit -m "feat(web): add Step3AdminProfile form"
```

---

## Task 12: Success screen component

**Files:**
- Create: `apps/web/app/onboarding/components/SuccessScreen.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/app/onboarding/components/SuccessScreen.tsx`:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/onboarding/components/SuccessScreen.tsx
git commit -m "feat(web): add SuccessScreen component"
```

---

## Task 13: Onboarding page orchestrator

**Files:**
- Create: `apps/web/app/onboarding/page.tsx`
- Create: `apps/web/__tests__/app/onboarding.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `apps/web/__tests__/app/onboarding.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OnboardingPage from "@/app/onboarding/page";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
  }),
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const validOrgBasics = { name: "Acme", industry: "delivery" as const, fleetSize: "1-5" as const };
const validAddress = {
  street: "1 Main St",
  city: "Boston",
  state: "MA",
  zip: "02101",
  country: "US",
};
const validProfile = { name: "Alice", phone: "5551234567", timezone: "America/New_York" };

function setupAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockedUseAuth.mockReturnValue({
    user: { uid: "u1" } as never,
    role: "admin",
    orgId: null,
    loading: false,
    logout: jest.fn(),
    refresh: jest.fn(),
    ...overrides,
  } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push: jest.fn(), replace: jest.fn() } as any);
});

describe("OnboardingPage", () => {
  it("starts at step 1 when no saved progress", async () => {
    setupAuth();
    mockedApiFetch.mockResolvedValueOnce({ wizardProgress: null });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Organization name/i)).toBeInTheDocument();
    });
  });

  it("resumes at step 2 when progress has currentStep=2", async () => {
    setupAuth();
    mockedApiFetch.mockResolvedValueOnce({
      wizardProgress: {
        currentStep: 2,
        data: { orgBasics: validOrgBasics },
        updatedAt: "2026-04-19T00:00:00.000Z",
      },
    });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Street/i)).toBeInTheDocument();
    });
  });

  it("PATCHes wizard-progress on Next and advances", async () => {
    setupAuth();
    mockedApiFetch
      .mockResolvedValueOnce({ wizardProgress: null }) // initial GET
      .mockResolvedValueOnce(undefined); // PATCH

    render(<OnboardingPage />);

    await waitFor(() => screen.getByLabelText(/Organization name/i));

    fireEvent.change(screen.getByLabelText(/Organization name/i), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText(/Industry/i), {
      target: { value: "delivery" },
    });
    fireEvent.change(screen.getByLabelText(/Fleet size/i), {
      target: { value: "1-5" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        "/me/wizard-progress",
        expect.objectContaining({ method: "PATCH" }),
      );
      expect(screen.getByLabelText(/Street/i)).toBeInTheDocument();
    });
  });

  it("submits POST /orgs on final Next and shows success screen", async () => {
    const refresh = jest.fn();
    setupAuth({ refresh });
    mockedApiFetch
      .mockResolvedValueOnce({
        wizardProgress: {
          currentStep: 3,
          data: { orgBasics: validOrgBasics, address: validAddress },
          updatedAt: "2026-04-19T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        org: { id: "org-1", name: "Acme" },
        user: { uid: "u1", orgId: "org-1" },
      });

    render(<OnboardingPage />);

    await waitFor(() => screen.getByLabelText(/Your name/i));

    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: validProfile.name } });
    fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: validProfile.phone } });
    fireEvent.change(screen.getByLabelText(/Timezone/i), { target: { value: validProfile.timezone } });

    fireEvent.click(screen.getByRole("button", { name: /Finish/i }));

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        "/orgs",
        expect.objectContaining({ method: "POST" }),
      );
      expect(refresh).toHaveBeenCalled();
      expect(screen.getByText(/You're all set/i)).toBeInTheDocument();
    });
  });

  it("non-admin is redirected to /dashboard", async () => {
    const replace = jest.fn();
    mockedUseRouter.mockReturnValue({ push: jest.fn(), replace } as any);
    setupAuth({ role: "driver" });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail with missing-module errors**

Run:
```bash
pnpm --filter @quickroutesai/web test -- onboarding.test.tsx
```

Expected: FAIL — `Cannot find module '@/app/onboarding/page'`.

- [ ] **Step 3: Create the page**

Create `apps/web/app/onboarding/page.tsx`:

```tsx
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

function zodErrorsToFieldMap<T>(error: { errors: { path: (string | number)[]; message: string }[] }): FieldErrors<T> {
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
      if (Object.keys(mergedData.orgBasics).length) {
        dataForApi.orgBasics = mergedData.orgBasics as OrgBasicsInput;
      }
      if (mergedData.address.street) {
        dataForApi.address = mergedData.address as OrgAddressInput;
      }
      if (Object.keys(mergedData.adminProfile).length) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm --filter @quickroutesai/web test -- onboarding.test.tsx
```

Expected: all 5 test cases pass.

- [ ] **Step 5: Run the full web test suite to confirm no regressions**

Run:
```bash
pnpm --filter @quickroutesai/web test
```

Expected: every test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/onboarding/page.tsx apps/web/__tests__/app/onboarding.test.tsx
git commit -m "feat(web): add /onboarding wizard page"
```

---

## Task 14: Manual smoke test and final full-suite run

**Files:** none — verification only.

- [ ] **Step 1: Build everything**

Run:
```bash
pnpm --filter @quickroutesai/shared build
pnpm --filter @quickroutesai/api build 2>/dev/null || pnpm --filter @quickroutesai/api exec tsc --noEmit
pnpm --filter @quickroutesai/web exec tsc --noEmit
```

Expected: all succeed.

- [ ] **Step 2: Run all tests**

Run:
```bash
pnpm --filter @quickroutesai/api test
pnpm --filter @quickroutesai/web test
```

Expected: all green.

- [ ] **Step 3: Manual smoke test (cannot claim feature complete without running this)**

Start the API:
```bash
pnpm --filter @quickroutesai/api dev
```

In another terminal, start the web app:
```bash
pnpm --filter @quickroutesai/web dev
```

Then:
1. Sign up a new admin via `/signup` (role=admin, fresh email).
2. Expect redirect to `/onboarding`.
3. Fill step 1 (any valid values), click Next → URL does not change but step 2 appears.
4. Refresh the page → expect to land back on step 2 with step-1 values intact (resume works).
5. Fill step 2, click Next → step 3.
6. Fill step 3, click Finish → success screen.
7. Click "Go to dashboard" → lands on `/dashboard` without being kicked back to `/onboarding`.
8. In Firestore console, verify: `orgs/{newId}` exists with `ownerUid` = the admin's uid; `users/{uid}` has `orgId` = that id; `wizardProgress` field is gone.
9. Sign up a fresh driver (role=driver). Land on `/dashboard`. Expect `<NoOrgNotice />` to render ("Waiting for organization setup").

If any step fails, return to the relevant task and fix — do not mark the plan complete.

- [ ] **Step 4: Final commit (if the smoke test reveals any touch-ups)**

Only if needed. No trailing "fix" commit required if everything works.

---

## Self-Review Findings

Run after writing the plan (findings below were applied inline before handoff):

**Spec coverage:**
- ✅ Acceptance criterion "3+ step wizard with validation" — Tasks 8–11 (shell + 3 steps), each with Zod validation.
- ✅ "Org document created in Firestore on completion" — Task 4 (`POST /orgs`).
- ✅ "Admin user linked to org" — Task 4 (transaction patches `users/{uid}.orgId`).
- ✅ "Success confirmation screen shown" — Tasks 12 + 13 (render `SuccessScreen` after successful `POST /orgs`).
- ✅ Resume from last step — Tasks 3 + 13 (GET on mount, PATCH on each Next).
- ✅ Dashboard gate for non-admins w/o org — Tasks 6 + 7 (`<NoOrgNotice />`).
- ✅ Atomic transaction refuses double-submit (409) — Task 4 test case.

**Placeholder scan:** none found.

**Type consistency:**
- `WizardProgress.data` shape in `types.ts` matches `wizardProgressSchema` and the `WizardData` shape used by the page.
- `CreateOrgInput` in `schemas.ts` matches the `POST /orgs` request body in Task 4 route + test + page submit.
- `useAuth()` signature in Task 5 matches the shape referenced in Tasks 7 + 13 tests.
- `requireRole` was initially proposed as a new middleware but already exists — plan updated to use the existing export.

**Spec-plan alignment check:** the plan calls out `admin.firestore.FieldValue.delete()` for removing `wizardProgress` — the test in Task 4 checks for `expect.anything()` in that field, which matches the sentinel without needing to assert its runtime shape (the sentinel is not serialization-stable in the mock).
