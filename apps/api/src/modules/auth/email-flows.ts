import type { Logger } from 'pino';
import type { Types } from 'mongoose';
import { EMAIL_VERIFICATION_TTL_HOURS, PASSWORD_RESET_TTL_MINUTES } from '@catalogcraft/shared';
import type { Mailer } from '../../services/email/mailer.js';
import { passwordResetEmail, verificationEmail } from '../../services/email/templates.js';
import { AppError } from '../../utils/app-error.js';
import { hashToken, newToken } from '../../utils/tokens.js';
import { EmailTokenModel, type EMAIL_TOKEN_PURPOSES } from './email-token.model.js';
import { hashPassword } from './password.js';
import { UserModel } from './user.model.js';

type Purpose = (typeof EMAIL_TOKEN_PURPOSES)[number];
export type EmailDeps = { mailer: Mailer; appUrl: string; logger: Logger };

const INVALID_LINK = 'This link is invalid or has expired. Ask for a new one.';

/** Issues a one-time token, cancelling any earlier unused ones for the same purpose. */
async function issueToken(userId: Types.ObjectId, purpose: Purpose, ttlMs: number): Promise<string> {
  await EmailTokenModel.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: new Date() } });
  const token = newToken();
  await EmailTokenModel.create({ userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

/** Marks a valid, unused, unexpired token as used (atomically) and returns its user id. */
async function consumeToken(token: string, purpose: Purpose): Promise<Types.ObjectId> {
  const record = await EmailTokenModel.findOneAndUpdate(
    { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  ).lean();
  if (!record) throw new AppError('BAD_REQUEST', INVALID_LINK);
  return record.userId;
}

/** Sends a "confirm your email" link. Email trouble is logged, never fatal to the caller. */
export async function sendVerificationEmail(deps: EmailDeps, user: { _id: Types.ObjectId; name: string; email: string }): Promise<boolean> {
  if (!deps.mailer.enabled) return false;
  try {
    const token = await issueToken(user._id, 'verify-email', EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
    await deps.mailer.send(
      verificationEmail({ to: user.email, name: user.name, url: `${deps.appUrl}/verify-email/${token}`, hours: EMAIL_VERIFICATION_TTL_HOURS }),
    );
    return true;
  } catch (error) {
    deps.logger.warn({ err: error }, 'Could not send the verification email');
    return false;
  }
}

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeToken(token, 'verify-email');
  await UserModel.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
}

/**
 * Starts a password reset. The answer is the same whether or not the email
 * has an account, and the work happens in the background, so neither the
 * response nor its timing reveals who is registered.
 */
export function requestPasswordReset(deps: EmailDeps, email: string): void {
  if (!deps.mailer.enabled) return;
  void (async () => {
    const user = await UserModel.findOne({ email, status: 'active' }).select('name email').lean();
    if (!user) return;
    const token = await issueToken(user._id, 'reset-password', PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
    await deps.mailer.send(
      passwordResetEmail({ to: user.email, name: user.name, url: `${deps.appUrl}/reset-password/${token}`, minutes: PASSWORD_RESET_TTL_MINUTES }),
    );
  })().catch((error: unknown) => deps.logger.warn({ err: error }, 'Could not send the password reset email'));
}

/**
 * Sets the new password and signs out every existing session. Opening the
 * emailed link also proves the address, so it counts as verified.
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const userId = await consumeToken(token, 'reset-password');
  const passwordHash = await hashPassword(password);
  const user = await UserModel.findOneAndUpdate(
    { _id: userId, status: 'active' },
    { $set: { passwordHash }, $inc: { authVersion: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!user) throw new AppError('BAD_REQUEST', INVALID_LINK);
  if (!user.emailVerifiedAt) await UserModel.updateOne({ _id: userId }, { $set: { emailVerifiedAt: new Date() } });
  // Any other reset links for this account stop working too.
  await EmailTokenModel.updateMany({ userId, purpose: 'reset-password', usedAt: null }, { $set: { usedAt: new Date() } });
}

/** Someone who opened a link sent to their address has proven they own it. */
export async function markEmailVerified(userId: Types.ObjectId | string): Promise<void> {
  await UserModel.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
}
