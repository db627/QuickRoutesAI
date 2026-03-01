const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const reactPath = require.resolve("react", { paths: [__dirname] });
const reactDomPath = require.resolve("react-dom", { paths: [__dirname] });
const reactJsxRuntimePath = require.resolve("react/jsx-runtime", { paths: [__dirname] });

const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^react$": reactPath,
    "^react-dom$": reactDomPath,
    "^react/jsx-runtime$": reactJsxRuntimePath,
  },
  testMatch: ["<rootDir>/**/__tests__/**/*.test.(ts|tsx)"],
  clearMocks: true,
};

module.exports = createJestConfig(customJestConfig);
