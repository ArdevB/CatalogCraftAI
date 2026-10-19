import { z } from 'zod';
import { organizationNameSchema, organizationSchema } from './organization.js';
import { permissionSchema, roleSchema } from './roles.js';

export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound stops attackers making the server hash megabyte-sized "passwords". */
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email address is too long.')
  .pipe(z.email('Enter a valid email address.'));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);

export const personNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your name.')
  .max(100, 'Name must be at most 100 characters.');

export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  organizationName: organizationNameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Login only checks presence: length rules belong to registration, and
  // revealing them on login would not help anyone sign in.
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH, 'Password is too long.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type User = z.infer<typeof userSchema>;

/** The signed-in user, their active organization, and what they may do there. */
export const sessionInfoSchema = z.object({
  user: userSchema,
  organization: organizationSchema,
  role: roleSchema,
  permissions: z.array(permissionSchema),
  /** Every organization the user belongs to, for switching between agencies. */
  organizations: z.array(z.object({ id: z.string(), name: z.string(), role: roleSchema })),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

/**
 * Header the web app sends on every request. Browsers do not let other
 * websites add custom headers to cross-site requests without a CORS
 * preflight (which our CORS policy rejects), so its presence proves the
 * request came from our own frontend. This is the CSRF defence.
 */
export const CSRF_HEADER = 'X-CatalogCraft-Request';
export const CSRF_HEADER_VALUE = '1';
