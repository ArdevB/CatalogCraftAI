import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id is the current OWASP-recommended password hashing algorithm. It is
 * deliberately slow and memory-hungry, which makes brute-forcing stolen hashes
 * expensive. The library's defaults (19 MiB memory, 2 iterations) match the
 * OWASP minimum, and the parameters are stored inside each hash so they can be
 * raised later without breaking existing passwords.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash must never let anyone in.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * When an email is not registered we still run one hash verification, so the
 * response takes as long as a wrong password would. Otherwise an attacker could
 * discover which emails have accounts by timing the login endpoint.
 */
export async function burnPasswordCheckTime(password: string): Promise<void> {
  dummyHash ??= hash('catalogcraft-timing-equalizer');
  await verifyPassword(await dummyHash, password);
}
