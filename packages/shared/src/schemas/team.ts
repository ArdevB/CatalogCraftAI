import { z } from 'zod';
import { emailSchema, loginSchema, passwordSchema, personNameSchema } from './auth.js';
import { objectIdSchema } from './common.js';

/** Roles that can be given by invitation or role change. There is exactly one owner: the founder. */
export const ASSIGNABLE_ROLES = ['admin', 'editor', 'reviewer'] as const;
export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES, { error: 'Choose admin, editor or reviewer.' });
export type AssignableRole = z.infer<typeof assignableRoleSchema>;

export const INVITATION_TTL_DAYS = 7;

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: assignableRoleSchema,
  /** Also email the link (when the server can send email). */
  sendEmail: z.boolean().default(true),
});
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: assignableRoleSchema,
  invitedBy: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/**
 * Returned once, when the invitation is created. The token is never stored
 * in readable form and can't be shown again — share the link straight away.
 */
export const createdInvitationSchema = z.object({
  invitation: invitationSchema,
  token: z.string(),
  /** Whether the link was emailed to the invitee. */
  emailed: z.boolean(),
});
export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;

/** What the invite page shows to whoever opens the link. */
export const invitationPreviewSchema = z.object({
  organizationName: z.string(),
  email: z.string(),
  role: assignableRoleSchema,
  invitedByName: z.string(),
  expiresAt: z.iso.datetime(),
  status: z.enum(['pending', 'expired', 'accepted', 'revoked']),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/** Creating an account from an invitation: the email comes from the invitation itself. */
export const registerFromInvitationSchema = z.object({
  name: personNameSchema,
  password: passwordSchema,
});
export type RegisterFromInvitationInput = z.infer<typeof registerFromInvitationSchema>;

/** Existing accounts join by confirming their password; the email is the invitation's. */
export const signInFromInvitationSchema = z.object({ password: loginSchema.shape.password });
export type SignInFromInvitationInput = z.infer<typeof signInFromInvitationSchema>;

export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This invitation link is not valid.');

export const updateMemberSchema = z.object({ role: assignableRoleSchema });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const switchOrganizationSchema = z.object({ organizationId: objectIdSchema });
