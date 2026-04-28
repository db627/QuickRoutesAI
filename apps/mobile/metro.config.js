const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const firebaseAppCjsPath = path.resolve(
  monorepoRoot,
  "node_modules/@firebase/app/dist/index.cjs.js",
);

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root for shared package changes
config.watchFolders = [monorepoRoot];
// Let Metro resolve packages from the monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force a single physical copy of React (and a few peers) regardless of import
// origin. With shamefully-hoist, each lives at both apps/mobile/node_modules
// AND the monorepo root, and Metro otherwise resolves to whichever sits
// closer to the importer — producing two distinct module instances and the
// classic "Invalid hook call / more than one copy of React" crash.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "react-native-web": path.resolve(projectRoot, "node_modules/react-native-web"),
};

// Force a single physical copy of each package by disabling Metro's default
// "walk up node_modules" behavior. With shamefully-hoist=true, packages exist
// at BOTH apps/mobile/node_modules and the root node_modules; without this
// flag Metro picks whichever sits closer to the importer, producing two
// distinct module instances (-> "Invalid hook call", "Tried to register two
// views with the same name", etc.).
config.resolver.disableHierarchicalLookup = true;

// Fix for pnpm hoisted node_modules: expo/AppEntry.js uses a hardcoded
// `import App from '../../App'` which breaks when node_modules is at the
// monorepo root. Redirect that import to the project's App.tsx.
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
