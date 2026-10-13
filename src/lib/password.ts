import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing using Argon2id — the modern, memory-hard algorithm
 * recommended by OWASP. Never store or log plaintext passwords.
 *
 * Uses @node-rs/argon2 (prebuilt binaries shipped as npm optional
 * dependencies) so it bundles correctly on Vercel/serverless. The default
 * algorithm is Argon2id, and the hash format is the standard PHC string,
 * so hashes created by the old `argon2` package still verify.
 */

const HASH_OPTIONS = {
  memoryCost: 19456, // ~19 MB, OWASP minimum recommendation
  timeCost: 2,
  parallelism: 1
};

export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword, HASH_OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  plainPassword: string
): Promise<boolean> {
  try {
    return await verify(storedHash, plainPassword);
  } catch {
    // Malformed hash or verify error — treat as invalid, never throw
    // to the caller (which could leak timing/error information).
    return false;
  }
}

/**
 * Minimum password policy enforced server-side, independent of any
 * frontend validation.
 */
export function isPasswordStrongEnough(plainPassword: string): boolean {
  if (plainPassword.length < 10) return false;
  const hasLetter = /[a-zA-Z]/.test(plainPassword);
  const hasNumber = /[0-9]/.test(plainPassword);
  return hasLetter && hasNumber;
}
