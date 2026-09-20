/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000",
    // Mirrored from the server's DEMO_USER_* so the sign-in page's one-click
    // demo button stays in step with the account that is actually seeded.
    NEXT_PUBLIC_DEMO_EMAIL: process.env.DEMO_USER_EMAIL ?? "demo@incidentos.dev",
    NEXT_PUBLIC_DEMO_PASSWORD: process.env.DEMO_USER_PASSWORD ?? "incident123",
  },
};
export default nextConfig;
