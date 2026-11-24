import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" }
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30000
  },
  resolve: {
    alias: {
      "jszip": path.resolve(__dirname, "apps/web/node_modules/jszip/lib/index.js"),
      "@": path.resolve(__dirname, "apps/web/src"),
      "next/server": path.resolve(__dirname, "apps/web/node_modules/next/server.js"),
      "next/headers": path.resolve(__dirname, "apps/web/node_modules/next/headers.js"),
      "next/link": path.resolve(__dirname, "apps/web/node_modules/next/link.js"),
      "next/navigation": path.resolve(__dirname, "apps/web/node_modules/next/navigation.js"),
      "next-themes": path.resolve(__dirname, "apps/web/node_modules/next-themes/dist/index.mjs"),
      "@tanstack/react-query": path.resolve(__dirname, "apps/web/node_modules/@tanstack/react-query/build/modern/index.js"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "apps/web/node_modules/react/jsx-dev-runtime.js"),
      "react/jsx-runtime": path.resolve(__dirname, "apps/web/node_modules/react/jsx-runtime.js"),
      "react-dom/server": path.resolve(__dirname, "apps/web/node_modules/react-dom/server.js"),
      "react-dom": path.resolve(__dirname, "apps/web/node_modules/react-dom/index.js"),
      "react": path.resolve(__dirname, "apps/web/node_modules/react/index.js"),
      "clsx": path.resolve(__dirname, "apps/web/node_modules/clsx/dist/clsx.mjs"),
      "tailwind-merge": path.resolve(__dirname, "apps/web/node_modules/tailwind-merge/dist/bundle-mjs.mjs"),
      "class-variance-authority": path.resolve(__dirname, "apps/web/node_modules/class-variance-authority/dist/index.mjs"),
      "lucide-react": path.resolve(__dirname, "apps/web/node_modules/lucide-react/dist/esm/lucide-react.js"),
      "@lutic/core/rbac": path.resolve(__dirname, "packages/core/src/rbac.ts"),
      "@lutic/core/metrics": path.resolve(__dirname, "packages/core/src/semantic/registry.ts"),
      "@lutic/core/dashboard": path.resolve(__dirname, "packages/core/src/dashboard/schema.ts"),
      "@lutic/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@lutic/connectors": path.resolve(__dirname, "packages/connectors/src/index.ts"),
      "@lutic/agent": path.resolve(__dirname, "packages/agent/src/index.ts")
    }
  }
});
