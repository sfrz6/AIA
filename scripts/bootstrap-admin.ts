import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { eq, sql } from "drizzle-orm";
import { auditLogs, users } from "@/db/schema";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { closeDatabase, fail, loadEnv, openDatabase } from "./lib";

loadEnv();

/**
 * Creates the first administrator.
 *
 * Credentials come from the environment when present, otherwise the script
 * prompts for them. Nothing is hardcoded and the command refuses to run once an
 * active administrator already exists, so it cannot be used to quietly add a
 * second privileged account to a live system.
 */
async function main(): Promise<void> {
  const db = openDatabase();

  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.isAdmin} and ${users.isActive}`);

  if ((existing?.count ?? 0) > 0 && !process.argv.includes("--force")) {
    fail(
      "An active administrator already exists. Use the Users page to add more, " +
        "or pass --force if you are deliberately recovering access.",
    );
  }

  let name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  let username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  let password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!name || !username || !password) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      name = name || (await rl.question("Administrator full name: ")).trim();
      username = username || (await rl.question("Administrator user name: ")).trim();
      password = password || (await rl.question("Administrator password: "));
    } finally {
      rl.close();
    }
  }

  if (!name) fail("A name is required.");
  if (!username || !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    fail("The user name must be 3 to 64 characters, letters, digits, dot, underscore or hyphen.");
  }
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    fail(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  const passwordHash = await hashPassword(password);

  const [created] = await db
    .insert(users)
    .values({ name, username, passwordHash, isAdmin: true, isActive: true })
    .onConflictDoNothing()
    .returning({ id: users.id, username: users.username });

  if (!created) {
    const [found] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`);
    if (found) {
      await db
        .update(users)
        .set({ passwordHash, isAdmin: true, isActive: true, name, updatedAt: new Date() })
        .where(eq(users.id, found.id));
      console.log(`Existing account "${username}" promoted and its password reset.`);
    } else {
      fail("Could not create the administrator account.");
    }
  } else {
    console.log(`Administrator "${created.username}" created.`);
  }

  await db.insert(auditLogs).values({
    actorUserId: null,
    actorName: "bootstrap script",
    action: "USER_BOOTSTRAPPED",
    entityType: "user",
    entityId: created?.id ?? null,
    afterData: { username, isAdmin: true },
  });

  console.log(
    "\n  Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now, and change the password after the first sign in.\n",
  );
  await closeDatabase(db);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
