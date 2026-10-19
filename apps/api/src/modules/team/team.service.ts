import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import {
  INVITATION_TTL_DAYS,
  type AssignableRole,
  type CreatedInvitation,
  type Invitation as InvitationDto,
  type InvitationPreview,
  type RegisterFromInvitationInput,
  type SignInFromInvitationInput,
} from '@catalogcraft/shared';
import { planLimits } from '../../config/plans.js';
import type { AuthContext } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { tenantScope } from '../../utils/tenant.js';
import { createUser, verifyCredentials } from '../auth/auth.service.js';
import { UserModel } from '../auth/user.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { InvitationModel, type Invitation } from './invitation.model.js';

type InvitationDoc = Invitation & { _id: Types.ObjectId };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const pendingFilter = () => ({ acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } });

/** Members plus pending invitations both count towards the plan's user limit. */
export async function teamSeats(organizationId: Types.ObjectId | string): Promise<{ used: number; limit: number | null }> {
  const [organization, members, invites] = await Promise.all([
    OrganizationModel.findById(organizationId).select('plan').lean(),
    MembershipModel.countDocuments({ organizationId }),
    InvitationModel.countDocuments({ organizationId, ...pendingFilter() }),
  ]);
  if (!organization) throw new AppError('NOT_FOUND', 'Organization not found.');
  return { used: members + invites, limit: planLimits(organization.plan).maxUsers };
}

async function toInvitationDtos(invitations: InvitationDoc[]): Promise<InvitationDto[]> {
  const users = await UserModel.find({ _id: { $in: invitations.map((i) => i.invitedBy) } }).select('name').lean();
  const names = new Map(users.map((user) => [user._id.toString(), user.name]));
  return invitations.map((invitation) => ({
    id: invitation._id.toString(),
    email: invitation.email,
    role: invitation.role,
    invitedBy: { id: invitation.invitedBy.toString(), name: names.get(invitation.invitedBy.toString()) ?? 'Former member' },
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  }));
}

export async function listInvitations(auth: AuthContext): Promise<InvitationDto[]> {
  const invitations = await InvitationModel.find({ ...tenantScope(auth), ...pendingFilter() }).sort({ createdAt: -1 }).lean();
  return toInvitationDtos(invitations);
}

/**
 * Creates an invitation and returns its one-time token. Re-inviting the same
 * email replaces the earlier pending invitation (so old links stop working).
 */
export async function createInvitation(auth: AuthContext, input: { email: string; role: AssignableRole }): Promise<CreatedInvitation> {
  if (auth.role !== 'owner' && input.role === 'admin') {
    throw new AppError('FORBIDDEN', 'Only the owner can invite admins.');
  }
  const existingUser = await UserModel.findOne({ email: input.email }).select('_id').lean();
  if (existingUser && (await MembershipModel.exists({ ...tenantScope(auth), userId: existingUser._id }))) {
    throw new AppError('CONFLICT', `${input.email} is already a member of this organization.`);
  }

  await InvitationModel.updateMany({ ...tenantScope(auth), email: input.email, ...pendingFilter() }, { $set: { revokedAt: new Date() } });
  const seats = await teamSeats(auth.organizationId);
  if (seats.limit !== null && seats.used >= seats.limit) {
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      `Your plan includes ${seats.limit} team member${seats.limit === 1 ? '' : 's'} (pending invitations count too). Upgrade to invite more people.`,
    );
  }

  // 32 random bytes → 43 URL-safe characters; guessing one is not feasible.
  const token = randomBytes(32).toString('base64url');
  const invitation = await InvitationModel.create({
    ...tenantScope(auth),
    email: input.email,
    role: input.role,
    tokenHash: hashToken(token),
    invitedBy: auth.userId,
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
  });
  const [dto] = await toInvitationDtos([invitation.toObject()]);
  return { invitation: dto!, token };
}

export async function revokeInvitation(auth: AuthContext, invitationId: string): Promise<void> {
  const result = await InvitationModel.updateOne(
    { _id: invitationId, ...tenantScope(auth), acceptedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  if (result.matchedCount === 0) throw new AppError('NOT_FOUND', 'Invitation not found.');
}

async function findByToken(token: string): Promise<InvitationDoc> {
  const invitation = await InvitationModel.findOne({ tokenHash: hashToken(token) }).lean();
  if (!invitation) throw new AppError('NOT_FOUND', 'This invitation link is not valid.');
  return invitation;
}

function invitationStatus(invitation: InvitationDoc): InvitationPreview['status'] {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.expiresAt <= new Date()) return 'expired';
  return 'pending';
}

/** Public: what the invite page shows to whoever has the link. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await findByToken(token);
  const [organization, inviter] = await Promise.all([
    OrganizationModel.findById(invitation.organizationId).select('name').lean(),
    UserModel.findById(invitation.invitedBy).select('name').lean(),
  ]);
  if (!organization) throw new AppError('NOT_FOUND', 'This invitation link is not valid.');
  return {
    organizationName: organization.name,
    email: invitation.email,
    role: invitation.role,
    invitedByName: inviter?.name ?? 'A team member',
    expiresAt: invitation.expiresAt.toISOString(),
    status: invitationStatus(invitation),
  };
}

const UNUSABLE: Record<Exclude<InvitationPreview['status'], 'pending'>, string> = {
  accepted: 'This invitation has already been used.',
  revoked: 'This invitation was cancelled. Ask for a new one.',
  expired: 'This invitation has expired. Ask for a new one.',
};

/**
 * Marks the invitation used and creates the membership. Atomic: if two people
 * click at the same moment, only one succeeds.
 */
async function claim(token: string, userId: Types.ObjectId): Promise<{ organizationId: string }> {
  const invitation = await findByToken(token);
  const status = invitationStatus(invitation);
  if (status !== 'pending') throw new AppError('CONFLICT', UNUSABLE[status]);
  if (await MembershipModel.exists({ organizationId: invitation.organizationId, userId })) {
    throw new AppError('CONFLICT', 'You are already a member of this organization.');
  }
  // The plan may have been downgraded since the invitation was sent.
  const [organization, members] = await Promise.all([
    OrganizationModel.findById(invitation.organizationId).select('plan').lean(),
    MembershipModel.countDocuments({ organizationId: invitation.organizationId }),
  ]);
  const limit = organization ? planLimits(organization.plan).maxUsers : 0;
  if (limit !== null && members >= limit) {
    throw new AppError('PLAN_LIMIT_REACHED', 'This organization has no free team seats left. Ask its owner to upgrade.');
  }

  const used = await InvitationModel.findOneAndUpdate(
    { _id: invitation._id, ...pendingFilter() },
    { $set: { acceptedAt: new Date(), acceptedBy: userId } },
  ).lean();
  if (!used) throw new AppError('CONFLICT', 'This invitation has already been used.');
  await MembershipModel.create({ organizationId: invitation.organizationId, userId, role: invitation.role });
  return { organizationId: invitation.organizationId.toString() };
}

/** A signed-in user accepts. The invitation is personal: the email must match. */
export async function acceptInvitation(auth: AuthContext, token: string): Promise<{ organizationId: string }> {
  const invitation = await findByToken(token);
  if (invitation.email !== auth.user.email.toLowerCase()) {
    throw new AppError('FORBIDDEN', `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`);
  }
  return claim(token, new Types.ObjectId(auth.userId));
}

/** Someone without an account creates one from the invitation (no new organization is created). */
export async function registerFromInvitation(
  token: string,
  input: RegisterFromInvitationInput,
): Promise<{ userId: string; organizationId: string }> {
  const invitation = await findByToken(token);
  const status = invitationStatus(invitation);
  if (status !== 'pending') throw new AppError('CONFLICT', UNUSABLE[status]);

  const user = await createUser({ name: input.name, email: invitation.email, password: input.password });
  try {
    const { organizationId } = await claim(token, user._id);
    return { userId: user._id.toString(), organizationId };
  } catch (error) {
    await UserModel.deleteOne({ _id: user._id }); // no half-created accounts
    throw error;
  }
}

/**
 * Someone with an account signs in from the invitation page and joins in one
 * step. This also works for accounts that belong to no organization any more
 * (and so can't use the normal sign-in).
 */
export async function signInFromInvitation(
  token: string,
  input: SignInFromInvitationInput,
): Promise<{ userId: string; organizationId: string }> {
  const invitation = await findByToken(token);
  const status = invitationStatus(invitation);
  if (status !== 'pending') throw new AppError('CONFLICT', UNUSABLE[status]);
  const userId = await verifyCredentials({ email: invitation.email, password: input.password });
  const { organizationId } = await claim(token, new Types.ObjectId(userId));
  return { userId, organizationId };
}

/* ----------------------------------------------------------------- Members */

/**
 * Who may change whom:
 * - nobody changes or removes the owner;
 * - admins manage editors and reviewers only, and can't grant admin;
 * - you can't change your own role.
 */
async function manageableMembership(auth: AuthContext, membershipId: string) {
  const membership = await MembershipModel.findOne({ _id: membershipId, ...tenantScope(auth) }).lean();
  if (!membership) throw new AppError('NOT_FOUND', 'Member not found.');
  if (membership.role === 'owner') throw new AppError('FORBIDDEN', 'The owner can’t be changed or removed.');
  if (membership.userId.toString() === auth.userId) throw new AppError('FORBIDDEN', 'You can’t change your own role.');
  if (auth.role === 'admin' && membership.role === 'admin') throw new AppError('FORBIDDEN', 'Only the owner can manage admins.');
  return membership;
}

export async function changeMemberRole(auth: AuthContext, membershipId: string, role: AssignableRole): Promise<void> {
  const membership = await manageableMembership(auth, membershipId);
  if (auth.role !== 'owner' && role === 'admin') throw new AppError('FORBIDDEN', 'Only the owner can make someone an admin.');
  await MembershipModel.updateOne({ _id: membership._id }, { $set: { role } });
}

/** Removes a member — or lets any non-owner leave by removing themselves. Takes effect on their next request. */
export async function removeMember(auth: AuthContext, membershipId: string): Promise<void> {
  const own = await MembershipModel.findOne({ _id: membershipId, ...tenantScope(auth), userId: auth.userId }).lean();
  if (own) {
    if (own.role === 'owner') throw new AppError('FORBIDDEN', 'The owner can’t leave their own organization.');
    await MembershipModel.deleteOne({ _id: own._id });
    return;
  }
  if (auth.role !== 'owner' && auth.role !== 'admin') throw new AppError('FORBIDDEN', 'Your role does not allow this action.');
  const membership = await manageableMembership(auth, membershipId);
  await MembershipModel.deleteOne({ _id: membership._id });
}
