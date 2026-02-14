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

## Setup

### 1. Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com) → Create project
2. Enable **Authentication** → Email/Password sign-in method
3. Enable **Cloud Firestore** → Start in test mode (deploy rules later)
4. Go to **Project Settings** → **Service Accounts** → Generate new private key (JSON)
5. Go to **Project Settings** → **General** → copy the web app Firebase config

### 2. Google Maps API Keys

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis)
2. Enable: **Maps JavaScript API**, **Directions API**, **Maps SDK for Android**, **Maps SDK for iOS**
3. Create two API keys:
   - **Browser key** (restricted to Maps JS API) → for web + mobile
   - **Server key** (restricted to Directions API) → for backend

### 3. Environment Variables

```bash
# Root — copy and fill in values
cp .env.example .env

# API
cp apps/api/.env.example apps/api/.env
# Fill in: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, GOOGLE_MAPS_SERVER_KEY

# Web
cp apps/web/.env.local.example apps/web/.env.local
# Fill in: all NEXT_PUBLIC_FIREBASE_* values and NEXT_PUBLIC_GOOGLE_MAPS_KEY

# Mobile
cp apps/mobile/.env.example apps/mobile/.env
# Fill in: all EXPO_PUBLIC_FIREBASE_* values and EXPO_PUBLIC_GOOGLE_MAPS_KEY
```

### 4. Install & Run

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
