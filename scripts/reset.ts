import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { sql } from "drizzle-orm";
import { closeDatabase, fail, loadEnv, openDatabase, requireDatabaseUrl } from "./lib";

loadEnv();

/**
 * Empties every table so a local database can be rebuilt from scratch.
 *
 * Destructive, and deliberately awkward: it prints the target, demands a typed
 * confirmation unless `--yes` is passed, and refuses outright when the
 * connection string does not look like a local or explicitly test database.
 */
const TABLES = [
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

function looksLocal(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url) || /_test\b|_e2e\b/i.test(url);
}

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const redacted = url.replace(/:[^:@/]*@/, ":****@");

  if (!looksLocal(url) && !process.argv.includes("--i-know-what-i-am-doing")) {
    fail(
      `Refusing to reset ${redacted}.\n  ` +
        "This does not look like a local or test database. If you really mean it, " +
        "pass --i-know-what-i-am-doing.",
    );
  }

  if (!process.argv.includes("--yes")) {
    console.log(`\n  This deletes every row in ${redacted}, including all users.\n`);
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = await rl.question('  Type "reset" to continue: ');
      if (answer.trim().toLowerCase() !== "reset") fail("Cancelled.");
    } finally {
      rl.close();
    }
  }

  const db = openDatabase();
  await db.execute(sql.raw(`truncate table ${TABLES.join(", ")} restart identity cascade`));

  console.log(`
  Database emptied. The country registry was cleared too, so rebuild with:

    npm run db:seed
    npm run db:bootstrap-admin
    npm run db:seed-demo
`);

  await closeDatabase(db);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
