import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from '../src/modules/auth/user.model.js';
import { ClientModel } from '../src/modules/clients/client.model.js';
import { MembershipModel } from '../src/modules/memberships/membership.model.js';
import { OrganizationModel } from '../src/modules/organizations/organization.model.js';
import { connectTestDatabase, disconnectTestDatabase } from './helpers.js';

beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

async function indexes(model: { listIndexes(): Promise<Array<{ key: object; unique?: boolean }>> }) {
  return (await model.listIndexes()).map(({ key, unique }) => ({ key, unique: unique ?? false }));
}

/**
 * Regression test: with command buffering disabled, Mongoose's automatic index
 * build used to run before the connection existed and silently create nothing.
 */
describe('database indexes', () => {
  it('enforces unique emails at the database level', async () => {
    expect(await indexes(UserModel)).toContainEqual({ key: { email: 1 }, unique: true });

    await UserModel.create({ name: 'A', email: 'same@example.test', passwordHash: 'x' });
    await expect(UserModel.create({ name: 'B', email: 'same@example.test', passwordHash: 'y' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('allows only one membership per user per organization', async () => {
    expect(await indexes(MembershipModel)).toContainEqual({ key: { organizationId: 1, userId: 1 }, unique: true });
  });

  it('keeps client names unique per organization, ignoring case', async () => {
    const organizationId = new Types.ObjectId();
    await ClientModel.create({ organizationId, name: 'Acme' });
    await expect(ClientModel.create({ organizationId, name: 'ACME' })).rejects.toMatchObject({ code: 11000 });
    // Same name in another organization is fine.
    await expect(ClientModel.create({ organizationId: new Types.ObjectId(), name: 'Acme' })).resolves.toBeDefined();
  });

  it('indexes organization owners', async () => {
    expect(await indexes(OrganizationModel)).toContainEqual({ key: { ownerUserId: 1 }, unique: false });
  });
});
