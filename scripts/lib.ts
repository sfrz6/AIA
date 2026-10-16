import { config } from "dotenv";
import { createDatabase, type Database } from "@/db";

/** Loads `.env.local` then `.env`, without overriding real process variables. */
export function loadEnv(): void {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
}

export function requireDatabaseUrl(variable = "DATABASE_URL"): string {
  const url = process.env[variable];
  if (!url) {
    throw new Error(`${variable} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return url;
}

export function openDatabase(variable = "DATABASE_URL"): Database {
  return createDatabase(requireDatabaseUrl(variable));
}

export async function closeDatabase(db: Database): Promise<void> {
  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
  if (client?.end) await client.end();
}

export function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}
