import { describe, expect, it } from 'vitest';
import {
  hasPermission,
  loginSchema,
  PERMISSIONS,
  permissionsForRole,
  registerSchema,
  ROLES,
  type Permission,
} from '../src/index.js';

const validRegistration = {
  name: 'Ada Agency',
  email: 'ada@example.com',
  password: 'correct horse battery',
  organizationName: 'Ada Digital',
};

describe('registerSchema', () => {
  it('normalizes email to lowercase and trims text', () => {
    const parsed = registerSchema.parse({
      ...validRegistration,
      name: '  Ada  ',
      email: '  Ada@Example.COM ',
      organizationName: ' Ada Digital ',
    });
    expect(parsed).toMatchObject({ name: 'Ada', email: 'ada@example.com', organizationName: 'Ada Digital' });
  });

  it.each([
    ['short password', { password: 'short' }],
    ['overlong password', { password: 'x'.repeat(129) }],
    ['invalid email', { email: 'not-an-email' }],
    ['empty name', { name: '   ' }],
    ['one-letter organization', { organizationName: 'A' }],
  ])('rejects %s', (_label, override) => {
    expect(registerSchema.safeParse({ ...validRegistration, ...override }).success).toBe(false);
  });

  it('does not trim passwords (spaces are valid password characters)', () => {
    expect(registerSchema.parse({ ...validRegistration, password: '  spaced password  ' }).password).toBe(
      '  spaced password  ',
    );
  });
});

describe('loginSchema', () => {
  it('only requires a non-empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('permissions', () => {
  it('gives the owner every permission', () => {
    expect(permissionsForRole('owner')).toEqual(Object.keys(PERMISSIONS));
  });

  it('applies the documented role rules', () => {
    const expectations: Array<[Permission, Record<(typeof ROLES)[number], boolean>]> = [
      ['organization:delete', { owner: true, admin: false, editor: false, reviewer: false }],
      ['organization:update', { owner: true, admin: true, editor: false, reviewer: false }],
      ['clients:manage', { owner: true, admin: true, editor: false, reviewer: false }],
      ['jobs:edit', { owner: true, admin: true, editor: true, reviewer: false }],
      ['suggestions:review', { owner: true, admin: true, editor: false, reviewer: true }],
    ];
    for (const [permission, byRole] of expectations) {
      for (const role of ROLES) {
        expect(hasPermission(role, permission), `${role} → ${permission}`).toBe(byRole[role]);
      }
    }
  });
});
