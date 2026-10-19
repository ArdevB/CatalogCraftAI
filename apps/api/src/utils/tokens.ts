import { createHash, randomBytes } from 'node:crypto';

/**
 * Secret link tokens (invitations, email confirmation, password reset).
 * 32 random bytes → 43 URL-safe characters; guessing one is not feasible.
 * Only the SHA-256 hash is stored, so a database leak can't be turned into
 * working links.
 */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
