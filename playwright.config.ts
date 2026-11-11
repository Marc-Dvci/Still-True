import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real pages served by `wrangler dev` (the Worker and its static assets).
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8788", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command:
      "npx vite build && npx wrangler dev --port 8788 --ip 127.0.0.1 --var DEMO:1 --var PUBLIC_ORIGIN:http://127.0.0.1:8788",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
