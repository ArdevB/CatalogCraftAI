import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { ConfigError, loadConfig } from '../config/env.js';
import { ensureIndexes, redactMongoUri } from '../config/database.js';
import { loadRootEnvFile } from '../config/load-env-file.js';
import { registerAccount } from '../modules/auth/auth.service.js';
import { UserModel } from '../modules/auth/user.model.js';
import { ClientModel } from '../modules/clients/client.model.js';
import { findDefaultMembership } from '../modules/memberships/membership.model.js';
import { OrganizationModel } from '../modules/organizations/organization.model.js';

/**
 * Creates clearly-labelled synthetic data for local development.
 * Safe to run repeatedly: existing seed records are left alone.
 *
 *   npm run seed
 */

const DEMO_EMAIL = 'demo@catalogcraft.test';
const SAMPLE_CLIENT_NAME = 'Northwind Home Goods (synthetic)';

async function ensureDemoAccount(): Promise<string> {
  const existing = await UserModel.findOne({ email: DEMO_EMAIL }).lean();
  if (existing) {
    console.log(`Demo account ${DEMO_EMAIL} already exists.`);
    const membership = await findDefaultMembership(existing._id);
    if (!membership) throw new Error('The demo account has no organization. Delete the user and re-run the seed.');
    return membership.organizationId.toString();
  }

  const password = process.env.SEED_DEMO_PASSWORD || randomBytes(12).toString('base64url');
  const { organizationId } = await registerAccount({
    name: 'Demo User (synthetic)',
    email: DEMO_EMAIL,
    password,
    organizationName: 'Demo Agency (synthetic data)',
  });

  console.log('\nCreated synthetic demo account:');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(
    process.env.SEED_DEMO_PASSWORD
      ? '  Password: the value of SEED_DEMO_PASSWORD in your .env'
      : `  Password: ${password}   (generated — set SEED_DEMO_PASSWORD in .env to choose your own)`,
  );
  // A new demo agency starts as a "pilot" on the Agency plan so several clients can be
  // tried out. Re-running the seed never changes a plan set later with set-plan.
  await OrganizationModel.updateOne({ _id: organizationId }, { plan: 'agency', subscriptionStatus: 'active' });
  return organizationId;
}

async function ensureSampleClient(organizationId: string): Promise<void> {
  if (await ClientModel.exists({ organizationId, name: SAMPLE_CLIENT_NAME })) {
    console.log(`Sample client "${SAMPLE_CLIENT_NAME}" already exists.`);
    return;
  }
  await ClientModel.create({
    organizationId,
    name: SAMPLE_CLIENT_NAME,
    internalReference: 'SYN-001',
    brandProfile: {
      brandTone: 'Warm, practical and plain-spoken. No hype.',
      targetAudience: 'Home owners furnishing kitchens and living rooms on a mid-range budget.',
      preferredTerminology: ['sofa (not couch)', 'cookware', 'stoneware'],
      prohibitedClaims: ['eco-friendly', 'best in class', 'lifetime guarantee'],
      defaultLanguage: 'en-GB',
      maxTitleLength: 120,
    },
  });
  console.log(`Created sample client "${SAMPLE_CLIENT_NAME}".`);
}

async function main(): Promise<void> {
  loadRootEnvFile();
  const config = loadConfig();
  if (config.isProduction) {
    throw new Error('Refusing to seed synthetic data with NODE_ENV=production.');
  }

  console.log(`Connecting to ${redactMongoUri(config.mongodbUri)} …`);
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 });
  await ensureIndexes();

  const organizationId = await ensureDemoAccount();
  await ensureSampleClient(organizationId);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof ConfigError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
