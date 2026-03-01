const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const firebaseAppCjsPath = path.resolve(
  monorepoRoot,
  "node_modules/@firebase/app/dist/index.cjs.js",
);

const config = getDefaultConfig(projectRoot);

// pnpm symlink support — lets Metro follow symlinks so that packages
// reachable via different symlink paths are treated as the same module.
config.resolver.unstable_enableSymlinks = true;

// Watch the monorepo root for shared package changes
config.watchFolders = [monorepoRoot];
// Let Metro resolve packages from the monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force Metro to resolve react/react-native from mobile's node_modules only
// to prevent picking up a duplicate copy from the monorepo root
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

// Prevent Metro from crawling into the web app's node_modules
config.resolver.blockList = [
  /apps\/web\/.*/,
  /apps\/api\/.*/,
];

// Fix for pnpm hoisted node_modules and Firebase CJS resolution
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@firebase/app") {
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
