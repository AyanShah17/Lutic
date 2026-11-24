/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@lutic/core",
    "@lutic/connectors",
    "@lutic/agent"
  ],
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pg",
    "pino",
    "unpdf",
    "jszip"
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push(/^@electric-sql\/pglite/, "pg", "unpdf", "jszip");
    }
    return config;
  },
  async headers() {
    const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
    const clerkOrigins = clerkEnabled
      ? " https://*.clerk.accounts.dev https://clerk.lutic.app https://accounts.lutic.app https://challenges.cloudflare.com"
      : "";
    const scriptSrc =
      "'self' 'unsafe-inline'" +
      (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'") +
      clerkOrigins;
    const imgSrc = clerkEnabled ? "'self' data: blob: https://img.clerk.com" : "'self' data: blob:";
    const connectSrc = clerkEnabled ? `'self'${clerkOrigins}` : "'self'";
    const frameSrc = clerkEnabled ? `frame-src${clerkOrigins}; ` : "";
    const workerSrc = clerkEnabled ? "worker-src 'self' blob:; " : "";
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src ${imgSrc}; font-src 'self' data:; connect-src ${connectSrc}; ${frameSrc}${workerSrc}frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;
