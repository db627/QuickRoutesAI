/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@quickroutesai/shared"],
  eslint: {
    // ESLint runs in CI / pre-commit. Don't gate Railway builds on it.
    // (eslint-plugin-react-hooks isn't configured here, so any
    // `eslint-disable-next-line react-hooks/exhaustive-deps` comment
    // becomes a hard error and breaks `next build`.)
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
