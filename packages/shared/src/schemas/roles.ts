import { z } from 'zod';

/**
 * Organization roles, from most to least privileged.
 *
 * - owner:    full control, including deleting the organization.
 * - admin:    manages clients, jobs and members.
 * - editor:   creates and edits catalogue jobs.
 * - reviewer: reviews and approves AI suggestions.
 */
export const ROLES = ['owner', 'admin', 'editor', 'reviewer'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * Every permission check in the API (and every button the web app shows or
 * hides) goes through this single table, so the rules live in one place.
 * The web app uses it only to hide actions; the API always enforces it.
 */
export const PERMISSIONS = {
  'organization:read': ['owner', 'admin', 'editor', 'reviewer'],
  'organization:update': ['owner', 'admin'],
  'organization:delete': ['owner'],
  'members:read': ['owner', 'admin', 'editor', 'reviewer'],
  'members:manage': ['owner', 'admin'],
  'clients:read': ['owner', 'admin', 'editor', 'reviewer'],
  'clients:manage': ['owner', 'admin'],
  'jobs:read': ['owner', 'admin', 'editor', 'reviewer'],
  'jobs:edit': ['owner', 'admin', 'editor'],
  'suggestions:review': ['owner', 'admin', 'reviewer'],
  'usage:read': ['owner', 'admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const permissionSchema = z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]]);

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsForRole(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((permission) => hasPermission(role, permission));
}
