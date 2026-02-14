# QuickRoutesAI

AI-powered route optimization platform for delivery and courier companies.

## Architecture

```
quickroutesai/
├── apps/
│   ├── api/          Express.js backend (Firebase Admin, Google Directions)
│   ├── web/          Next.js dispatcher dashboard (Tailwind, Google Maps)
│   └── mobile/       Expo React Native driver app (NativeWind, react-native-maps)
├── packages/
│   └── shared/       Shared TypeScript types + Zod validation schemas
├── firestore.rules   Firestore security rules
└── docs/             Sprint plan and project structure docs
```

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 8 (`npm install -g pnpm`)
- **Expo CLI** (`npx expo`)
- **Firebase Project** with Auth + Firestore enabled
- **Google Cloud** API keys (Maps JavaScript API, Directions API)

## Install & Run

```bash
# Install all dependencies
pnpm install

# Run API + Web together
pnpm dev

# Run individually
pnpm --filter api dev        # http://localhost:3001
pnpm --filter web dev        # http://localhost:3000

# Mobile (separate terminal)
cd apps/mobile
npx expo start
```

### 5. Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

## API Endpoints

All endpoints except `/health` require `Authorization: Bearer <firebase-id-token>`.

| Method | Path                    | Role              | Description                              |
|--------|-------------------------|-------------------|------------------------------------------|
| GET    | `/health`               | Public            | Health check                             |
| GET    | `/me`                   | Any authenticated | Get current user profile + role          |
| POST   | `/drivers/location`     | Driver            | Post GPS location ping                   |
| GET    | `/drivers/active`       | Dispatcher/Admin  | List online drivers with positions       |
| POST   | `/trips`                | Dispatcher/Admin  | Create trip with stops                   |
| POST   | `/trips/:id/assign`     | Dispatcher/Admin  | Assign driver to trip                    |
| GET    | `/trips/:id`            | Any (scoped)      | Get trip details                         |
| POST   | `/trips/:id/route`      | Dispatcher/Admin  | Compute route via Google Directions API  |
| POST   | `/trips/:id/status`     | Driver/Dispatcher | Update trip status                       |

## Firestore Collections

| Collection       | Key Fields                                          |
|------------------|-----------------------------------------------------|
| `users/{uid}`    | role, name, email, createdAt                        |
| `drivers/{uid}`  | isOnline, lastLocation, lastSpeedMps, updatedAt     |
| `trips/{tripId}` | driverId, status, stops[], route, createdBy          |
| `events/{id}`    | type, driverId, payload, createdAt                  |

## Tech Stack

| Layer     | Technology                                |
|-----------|-------------------------------------------|
| Backend   | Express.js + TypeScript + Firebase Admin  |
| Web       | Next.js 14 + Tailwind CSS                |
| Mobile    | Expo (React Native) + NativeWind         |
| Database  | Cloud Firestore                          |
| Auth      | Firebase Auth (email/password)            |
| Maps      | Google Maps JS API + Directions API       |
| Validation| Zod (shared schemas)                     |
| Monorepo  | pnpm workspaces                          |
