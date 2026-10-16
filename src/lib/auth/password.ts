import bcrypt from "bcryptjs";

/**
 * Work factor for password hashing. 12 rounds costs roughly a quarter of a
 * second on current serverless hardware, which is a sensible balance between
 * login latency and resistance to offline cracking.
 */
const COST = 12;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * A hash of a password that cannot match. Used to keep the cost of a failed
 * login the same whether or not the account exists, so that response timing
 * does not reveal which usernames are registered.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.2UOkfpEkcAHaIBbVY9/yVNJmPRKwtVa";

export async function burnPasswordComparison(plain: string): Promise<void> {
  await verifyPassword(plain, DUMMY_HASH);
}
