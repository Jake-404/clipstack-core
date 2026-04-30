/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // typedRoutes is disabled until the /inbox /workspace /calendar /settings
  // routes actually exist as app/ subdirs. The Sidebar references them ahead
  // of time; flipping typedRoutes on with non-existent targets fails build.
  // Re-enable once those pages ship (later A.2).
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
