import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * The suite runs against a dedicated database, which global setup wipes and
 * reseeds, so it never touches development data.
 */
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "en-GB",
    timezoneId: "UTC",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next build && npx next start --port ${PORT}`,
        url: `${baseURL}/sign-in`,
        reuseExistingServer: false,
        timeout: 420_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          DATABASE_URL: databaseUrl,
          DATABASE_DRIVER: "pg",
          SESSION_SECRET:
            process.env.SESSION_SECRET ?? "end_to_end_session_secret_at_least_32_chars_long",
          NODE_ENV: "production",
        },
      },
});
