/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@node-rs/argon2"],
    serverActions: {
      bodySizeLimit: "5mb"
    }
  },
  images: {
    remotePatterns: []
  },
  async redirects() {
    // Stage 2: the standalone "Student Attendance" page was folded into the
    // Lessons page. Keep old bookmarks working.
    return [
      { source: "/dashboard/attendance", destination: "/dashboard/academic/sessions", permanent: false }
    ];
  }
};

export default nextConfig;
