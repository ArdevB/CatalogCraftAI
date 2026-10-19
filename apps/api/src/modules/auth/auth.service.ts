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
  const user = await createUser(input);

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

/** Creates a user with a hashed password, refusing emails that are already registered. */
export async function createUser(input: { name: string; email: string; password: string }) {
  if (await UserModel.exists({ email: input.email })) {
    throw new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
  }
  const passwordHash = await hashPassword(input.password);
  try {
    return await UserModel.create({ name: input.name, email: input.email, passwordHash });
  } catch (error) {
    // Two sign-ups with the same email at the same moment: the unique index wins.
    if (isDuplicateKeyError(error)) {
      throw new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
    }
    throw error;
  }
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
  const memberships = await MembershipModel.find({ userId: auth.userId }).sort({ createdAt: 1 }).lean();
  const organizations = await OrganizationModel.find({ _id: { $in: memberships.map((m) => m.organizationId) } })
    .select('name')
    .lean();
  const names = new Map(organizations.map((org) => [org._id.toString(), org.name]));
  return {
    user: auth.user,
    organization: toOrganizationDto(organization),
    role: auth.role,
    permissions: permissionsForRole(auth.role),
    organizations: memberships
      .filter((membership) => names.has(membership.organizationId.toString()))
      .map((membership) => ({
        id: membership.organizationId.toString(),
        name: names.get(membership.organizationId.toString())!,
        role: membership.role,
      })),
  };
}

/** Checks the signed-in user's password; a wrong one is a field error, never a sign-out. */
async function confirmPassword(userId: string, password: string, field: string) {
  const user = await UserModel.findById(userId).select('+passwordHash').lean();
  if (!user) throw new AppError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new AppError('VALIDATION_ERROR', 'That password is not correct.', {
      details: [{ path: `body.${field}`, message: 'That password is not correct.' }],
    });
  }
  return user;
}

/**
 * Sets a new password and increases `authVersion`, which signs out every
 * other session. Returns the new version for the caller's fresh session.
 */
export async function changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<number> {
  await confirmPassword(auth.userId, currentPassword, 'currentPassword');
  const updated = await UserModel.findByIdAndUpdate(
    auth.userId,
    { $set: { passwordHash: await hashPassword(newPassword) }, $inc: { authVersion: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw new AppError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  return updated.authVersion;
}

/**
 * Permanently deletes the signed-in user's account and memberships. Refused
 * while they own an organization, so no agency is ever left without an owner:
 * they delete the organization first. Jobs, exports and audit entries they
 * created stay with the organization and show "Former member".
 */
export async function deleteAccount(auth: AuthContext, password: string): Promise<void> {
  const user = await confirmPassword(auth.userId, password, 'password');
  const owned = await MembershipModel.find({ userId: user._id, role: 'owner' }).select('organizationId').lean();
  if (owned.length > 0) {
    const names = await OrganizationModel.find({ _id: { $in: owned.map((m) => m.organizationId) } }).select('name').lean();
    throw new AppError(
      'CONFLICT',
      `You own ${names.map((o) => `“${o.name}”`).join(', ')}. Delete ${owned.length === 1 ? 'that organization' : 'those organizations'} first (Organization settings → Delete organization).`,
    );
  }
  await MembershipModel.deleteMany({ userId: user._id });
  await UserModel.deleteOne({ _id: user._id });
}
