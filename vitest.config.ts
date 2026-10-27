import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      PGLITE_DIR: "memory://",
      // Tests must never hit a real AI provider, even with keys in .env.local.
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GEMINI_API_KEY: "",
      AI_GATEWAY_API_KEY: "",
      VERCEL_OIDC_TOKEN: "",
    },
  },
});
