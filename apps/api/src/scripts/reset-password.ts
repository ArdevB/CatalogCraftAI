import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { redactMongoUri } from '../config/database.js';
import { ConfigError, loadConfig } from '../config/env.js';
import { loadRootEnvFile } from '../config/load-env-file.js';
import { hashPassword } from '../modules/auth/password.js';
import { UserModel } from '../modules/auth/user.model.js';

/**
 * For a pilot user who forgot their password (there is no email service for
 * self-service resets):
 *
 *   npm run reset-password -- <email>
 *
 * Sets a random temporary password, prints it once, and signs the user out
 * everywhere. Send it to them over a channel you trust, and ask them to change
 * it in Account → Change password straight away.
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run reset-password -- <email>');

  loadRootEnvFile();
  const config = loadConfig();
  console.log(`Connecting to ${redactMongoUri(config.mongodbUri)} …`);
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 });

  // 18 random bytes → 24 URL-safe characters: easy to copy, impossible to guess.
  const temporary = randomBytes(18).toString('base64url');
  const user = await UserModel.findOneAndUpdate(
    { email },
    { $set: { passwordHash: await hashPassword(temporary) }, $inc: { authVersion: 1 } },
  ).lean();
  if (!user) throw new Error(`No user with email ${email}.`);

  console.log(`\nTemporary password for ${email}:\n\n  ${temporary}\n`);
  console.log('All of their existing sessions have been signed out.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof ConfigError || error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
