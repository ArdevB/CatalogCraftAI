import mongoose from 'mongoose';
import { planIdSchema } from '@catalogcraft/shared';
import { ConfigError, loadConfig } from '../config/env.js';
import { redactMongoUri } from '../config/database.js';
import { loadRootEnvFile } from '../config/load-env-file.js';
import { PLANS } from '../config/plans.js';
import { UserModel } from '../modules/auth/user.model.js';
import { OrganizationModel } from '../modules/organizations/organization.model.js';

/**
 * Manual plan changes for pilot customers (there is no payment integration).
 *
 *   npm run set-plan -- <owner-email> <trial|solo|agency|studio>
 *
 * Changes every organization owned by that user and marks it `active`
 * (or `trialing` for the trial plan).
 */
async function main(): Promise<void> {
  const [email, planArg] = process.argv.slice(2);
  const plan = planIdSchema.safeParse(planArg);
  if (!email || !plan.success) {
    throw new Error(`Usage: npm run set-plan -- <owner-email> <${Object.keys(PLANS).join('|')}>`);
  }

  loadRootEnvFile();
  const config = loadConfig();
  console.log(`Connecting to ${redactMongoUri(config.mongodbUri)} …`);
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 });

  const user = await UserModel.findOne({ email: email.trim().toLowerCase() }).lean();
  if (!user) throw new Error(`No user with email ${email}.`);

  const subscriptionStatus = plan.data === 'trial' ? 'trialing' : 'active';
  const result = await OrganizationModel.updateMany({ ownerUserId: user._id }, { plan: plan.data, subscriptionStatus });
  if (result.matchedCount === 0) throw new Error(`${email} does not own an organization.`);

  console.log(`Set ${result.matchedCount} organization(s) owned by ${email} to the ${PLANS[plan.data].label} plan.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof ConfigError || error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
