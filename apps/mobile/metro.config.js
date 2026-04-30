const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

// Resolve @firebase/app's CJS entry at config time using Node's resolution
// from the mobile project. This walks the symlink/hoist chain regardless of
// whether deps are at the root or in the workspace's own node_modules.
let firebaseAppCjsPath;
try {
  firebaseAppCjsPath = require.resolve("@firebase/app/dist/index.cjs.js", {
    paths: [projectRoot],
  });
} catch {
  firebaseAppCjsPath = null;
}

const config = getDefaultConfig(projectRoot);

// Disable Metro's package.json "exports" resolution. Firebase 10's `@firebase/auth`
// package uses the legacy `react-native` field (not `exports`) to ship the
// React-Native-specific build that registers the auth component. With exports
// resolution on (Expo 54 default), Metro picks the browser build and the
// `Component auth has not been registered yet` error fires at startup.
config.resolver.unstable_enablePackageExports = false;

// Watch the monorepo root for shared package changes
config.watchFolders = [monorepoRoot];
// Let Metro resolve packages from the monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Fix for pnpm hoisted node_modules: expo/AppEntry.js uses a hardcoded
// `import App from '../../App'` which breaks when node_modules is at the
// monorepo root. Redirect that import to the project's App.tsx.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@firebase/app" && firebaseAppCjsPath) {
    return {
      filePath: firebaseAppCjsPath,
      type: "sourceFile",
    };
  }
  if (
    moduleName === "../../App" &&
    context.originModulePath.includes("expo/AppEntry")
  ) {
    return context.resolveRequest(
      context,
      path.resolve(projectRoot, "App"),
      platform,
    );
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
