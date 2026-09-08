import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: [
    "192.168.1.36",
    "*.ngrok-free.dev",
    "multistaminate-possibly-micheal.ngrok-free.dev",
  ],
  // Proxy all /api/* requests from the Next.js dev server to FastAPI.
  // This means the browser only talks to ONE origin (Next.js), and
  // Next.js forwards API calls server-side to localhost:8000.
  // No CORS, no second tunnel, no NEXT_PUBLIC_API_URL needed.
  async rewrites() {
    // Keep this for local development only. In production (Vercel → Render)
    // the frontend calls the backend directly via NEXT_PUBLIC_BACKEND_URL
    // in src/lib/api.ts, so no proxy rewrite is required.
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
