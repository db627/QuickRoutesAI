import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@quickroutesai/shared$": "<rootDir>/../../packages/shared/src",
  },
  setupFilesAfterSetup: [],
  clearMocks: true,
};

export default config;
