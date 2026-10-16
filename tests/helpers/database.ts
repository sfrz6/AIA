import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/**
 * Integration tests run against a real PostgreSQL database, because the
 * behaviour under test is largely enforced by the database: unique indexes,
 * check constraints, foreign keys and transactions. They are skipped when
 * `TEST_DATABASE_URL` is absent so that `npm test` still works on a machine
 * with no database.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

if (TEST_DATABASE_URL) {
  // Point the application's own connection factory at the test database before
  // any module reads it.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.DATABASE_DRIVER = process.env.DATABASE_DRIVER ?? "pg";
}

/** Tables emptied between tests, ordered so foreign keys are never violated. */
const TRUNCATED = [
  "audit_logs",
  "run_revisions",
  "run_score_targets",
  "run_scores",
  "run_scoring_units",
  "run_entry_order_items",
  "run_entry_orders",
  "tie_break_entry_scores",
  "tie_break_entries",
  "tie_break_rounds",
  "championship_riders",
  "championship_countries",
  "championship_runs",
  "championship_events",
  "championship_days",
  "championships",
  "template_runs",
  "template_events",
  "template_days",
  "championship_templates",
  "riders",
  "sessions",
  "user_permissions",
  "users",
] as const;

export async function resetDatabase(): Promise<void> {
  if (!TEST_DATABASE_URL) return;
  const { getDb } = await import("@/db");
  const db = getDb();
  await db.execute(sql.raw(`truncate table ${TRUNCATED.join(", ")} restart identity cascade`));
}
