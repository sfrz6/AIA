import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as NodePool } from "pg";
import ws from "ws";
import * as schema from "./schema";

export { schema };

export type Database = ReturnType<typeof createDatabase>;

/**
 * Transaction handle. Every service that must run atomically accepts this type
 * so that it works both inside and outside an enclosing transaction.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type Executor = Database | Transaction;

function resolveDriver(connectionString: string): "neon" | "pg" {
  const configured = process.env.DATABASE_DRIVER?.toLowerCase();
  if (configured === "neon" || configured === "pg") return configured;
  return /neon\.(tech|build)/i.test(connectionString) ? "neon" : "pg";
}

export function createDatabase(connectionString: string) {
  if (resolveDriver(connectionString) === "neon") {
    // Node runtimes before 22 have no global WebSocket, which the Neon pool
    // needs for transactions.
    if (typeof WebSocket === "undefined") {
      neonConfig.webSocketConstructor = ws;
    }
    // Capped low: each serverless function instance caches its own pool on
    // `globalThis`, and Vercel can spin up many instances concurrently under
    // a burst of cold starts, so an uncapped pool here risks piling up more
    // connections than Neon's plan allows. A handful per instance is plenty
    // for this app's traffic (competition staff and the public results page,
    // not a high-throughput API).
    return drizzleNeon({ client: new NeonPool({ connectionString, max: 5 }), schema });
  }
  return drizzleNode({ client: new NodePool({ connectionString, max: 5 }), schema });
}

declare global {
  var __aiaDatabase: Database | undefined;
}

/**
 * Process wide database handle.
 *
 * Serverless functions are reused between invocations, so the pool is cached on
 * `globalThis` to avoid opening a new connection on every request and to
 * survive the module reloads the development server performs.
 */
export function getDb(): Database {
  if (globalThis.__aiaDatabase) return globalThis.__aiaDatabase;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and set a PostgreSQL connection string.",
    );
  }

  const database = createDatabase(connectionString);
  globalThis.__aiaDatabase = database;
  return database;
}
