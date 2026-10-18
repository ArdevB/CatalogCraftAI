import { permissionsForRole, type LoginInput, type RegisterInput, type SessionInfo } from '@catalogcraft/shared';
import type { AuthContext } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { toOrganizationDto } from '../organizations/organization.dto.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { burnPasswordCheckTime, hashPassword, verifyPassword } from './password.js';
import { UserModel } from './user.model.js';

const INVALID_CREDENTIALS = 'Invalid email or password.';

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/**
 * Creates the user, their agency organization and an `owner` membership.
 *
 * MongoDB multi-document transactions need a replica set, which a plain local
 * MongoDB install is not. So instead we create the records in order and, if a
 * later step fails, delete the earlier ones — no half-created accounts.
 */
export async function registerAccount(input: RegisterInput): Promise<{ userId: string; organizationId: string }> {
  if (await UserModel.exists({ email: input.email })) {
    throw new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
  }

  const passwordHash = await hashPassword(input.password);

  let user;
  try {
    user = await UserModel.create({ name: input.name, email: input.email, passwordHash });
  } catch (error) {
    // Two sign-ups with the same email at the same moment: the unique index wins.
    if (isDuplicateKeyError(error)) {
      throw new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
    }
    throw error;
  }

  let organizationId: string | undefined;
  try {
    const organization = await OrganizationModel.create({ name: input.organizationName, ownerUserId: user._id });
    organizationId = organization._id.toString();
    await MembershipModel.create({ organizationId: organization._id, userId: user._id, role: 'owner' });
  } catch (error) {
    await Promise.allSettled([
      UserModel.deleteOne({ _id: user._id }),
      organizationId ? OrganizationModel.deleteOne({ _id: organizationId }) : Promise.resolve(),
    ]);
    throw error;
  }

  return { userId: user._id.toString(), organizationId };
}

/** Returns the user id if the email/password pair is valid; otherwise throws a generic error. */
export async function verifyCredentials(input: LoginInput): Promise<string> {
  const user = await UserModel.findOne({ email: input.email }).select('+passwordHash').lean();

  if (!user) {
    await burnPasswordCheckTime(input.password);
    throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS);
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS);
  }
  // Only revealed after a correct password, so it leaks nothing to guessers.
  if (user.status !== 'active') {
    throw new AppError('FORBIDDEN', 'This account has been disabled. Contact your organization owner.');
  }

  await UserModel.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  return user._id.toString();
}

export async function buildSessionInfo(auth: AuthContext): Promise<SessionInfo> {
  const organization = await OrganizationModel.findById(auth.organizationId).lean();
  if (!organization) {
    throw new AppError('UNAUTHENTICATED', 'Your organization no longer exists. Please sign in again.');
  }
  return {
    user: auth.user,
    organization: toOrganizationDto(organization),
    role: auth.role,
    permissions: permissionsForRole(auth.role),
  };
}
