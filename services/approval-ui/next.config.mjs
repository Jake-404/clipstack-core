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
  // Asset adapter native bindings — @resvg/resvg-js ships a platform-
  // native rasterizer (.node files) that webpack can't bundle. Marking
  // it as a server-external package means Node's require() resolves it
  // at call time from node_modules instead of webpack trying to inline
  // its binary. Same for satori (its dependency tree includes deps that
  // don't bundle cleanly through Next.js's webpack).
  serverExternalPackages: ["@resvg/resvg-js", "satori"],
};

export default nextConfig;
