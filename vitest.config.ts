import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects: `unit` runs the pure decision core in Node with coverage; `worker` runs routes and
// Durable Objects inside workerd (the Workers runtime) through Cloudflare's Vitest plugin.
export default defineConfig({
  test: {
    testTimeout: 15_000,
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      reporter: ["text", "json-summary", "markdown"],
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
    projects: [
      {
        test: { name: "unit", include: ["test/unit/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                BUFFER_CLIENT_ID: "test-client",
                BUFFER_CLIENT_SECRET: "test-secret",
                BUFFER_REDIRECT_URI: "https://still-true.test/auth/callback",
                SESSION_SECRET: "c2Vzc2lvbi1zZWNyZXQtZm9yLXRlc3RzLW9ubHktMzI=",
                TOKEN_KEY: "dG9rZW4ta2V5LWZvci10ZXN0cy1vbmx5LTMyYnl0ZXM=",
                DEMO: "1",
              },
            },
          }),
        ],
        test: { name: "worker", include: ["test/worker/**/*.test.ts"] },
      },
    ],
  },
});
