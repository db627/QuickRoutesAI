import "@testing-library/jest-dom";

// Ensure the Google Maps key is truthy so the map block renders in tests.
// The real key is loaded from .env.local in development; this fallback
// covers CI where that file is absent.
process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ??= "test-key";
