import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { migrate as migrateNode } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, loadEnv, openDatabase, requireDatabaseUrl } from "./lib";

loadEnv();

const MIGRATIONS_FOLDER = "./src/db/migrations";

async function main(): Promise<void> {
  const variable = process.argv.includes("--test") ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const url = requireDatabaseUrl(variable);
  const db = openDatabase(variable);

  const isNeon = /neon\.(tech|build)/i.test(url) || process.env.DATABASE_DRIVER === "neon";
  console.log(`Applying migrations to ${url.replace(/:[^:@/]*@/, ":****@")}`);

  if (isNeon) {
    await migrateNeon(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    await migrateNode(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  console.log("Migrations applied.");
  await closeDatabase(db);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
