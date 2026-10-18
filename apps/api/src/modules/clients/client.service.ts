import type { Types } from 'mongoose';
import {
  buildPaginationMeta,
  type Client as ClientDto,
  type ClientList,
  type ClientListQuery,
  type CreateClientData,
  type UpdateClientData,
  type WorkspaceAllowance,
} from '@catalogcraft/shared';
import { planLimits } from '../../config/plans.js';
import type { AuthContext } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { escapeRegex } from '../../utils/escape-regex.js';
import { tenantScope } from '../../utils/tenant.js';
import { CatalogJobModel } from '../catalog-jobs/catalog-job.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { CLIENT_NAME_COLLATION, ClientModel, type Client } from './client.model.js';

export function toClientDto(client: Client & { _id: Types.ObjectId }): ClientDto {
  return {
    id: client._id.toString(),
    name: client.name,
    internalReference: client.internalReference || null,
    brandProfile: {
      brandTone: client.brandProfile.brandTone,
      targetAudience: client.brandProfile.targetAudience,
      preferredTerminology: [...client.brandProfile.preferredTerminology],
      prohibitedClaims: [...client.brandProfile.prohibitedClaims],
      defaultLanguage: client.brandProfile.defaultLanguage,
      maxTitleLength: client.brandProfile.maxTitleLength,
    },
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

function duplicateNameError(name: string): AppError {
  return new AppError('CONFLICT', `A client named “${name}” already exists in your organization.`);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export async function getWorkspaceAllowance(auth: AuthContext): Promise<WorkspaceAllowance> {
  const [organization, used] = await Promise.all([
    OrganizationModel.findById(auth.organizationId).select('plan').lean(),
    ClientModel.countDocuments(tenantScope(auth)),
  ]);
  if (!organization) throw new AppError('NOT_FOUND', 'Organization not found.');
  return { used, limit: planLimits(organization.plan).maxClientWorkspaces };
}

export async function listClients(auth: AuthContext, query: ClientListQuery): Promise<ClientList> {
  const filter = {
    ...tenantScope(auth),
    ...(query.search
      ? {
          $or: [
            { name: { $regex: escapeRegex(query.search), $options: 'i' } },
            { internalReference: { $regex: escapeRegex(query.search), $options: 'i' } },
          ],
        }
      : {}),
  };

  const [clients, totalItems, allowance] = await Promise.all([
    ClientModel.find(filter)
      .collation(CLIENT_NAME_COLLATION)
      .sort({ name: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean(),
    ClientModel.countDocuments(filter),
    getWorkspaceAllowance(auth),
  ]);

  return { items: clients.map(toClientDto), pagination: buildPaginationMeta(query, totalItems), allowance };
}

/**
 * Loads one client, scoped to the caller's organization. Another agency's
 * client id gives exactly the same "not found" as an id that doesn't exist,
 * so ids can't even be used to probe whether a client exists elsewhere.
 */
export async function getClient(auth: AuthContext, clientId: string) {
  const client = await ClientModel.findOne({ _id: clientId, ...tenantScope(auth) }).lean();
  if (!client) throw new AppError('NOT_FOUND', 'Client not found.');
  return client;
}

export async function createClient(auth: AuthContext, data: CreateClientData) {
  const allowance = await getWorkspaceAllowance(auth);
  // Note: two simultaneous requests could both pass this check. Acceptable for
  // a soft commercial limit; it is not a security boundary.
  if (allowance.limit !== null && allowance.used >= allowance.limit) {
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      `Your plan includes ${allowance.limit} client workspace${allowance.limit === 1 ? '' : 's'}. Upgrade to add more clients.`,
    );
  }

  try {
    const client = await ClientModel.create({
      ...tenantScope(auth),
      name: data.name,
      internalReference: data.internalReference || undefined,
      brandProfile: data.brandProfile,
    });
    return client.toObject();
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateNameError(data.name);
    throw error;
  }
}

export async function updateClient(auth: AuthContext, clientId: string, data: UpdateClientData) {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};

  if (data.name !== undefined) set.name = data.name;
  if (data.internalReference !== undefined) {
    if (data.internalReference) set.internalReference = data.internalReference;
    else unset.internalReference = '';
  }
  // Update only the brand fields that were sent, leaving the others untouched.
  for (const [key, value] of Object.entries(data.brandProfile ?? {})) {
    if (value !== undefined) set[`brandProfile.${key}`] = value;
  }

  try {
    const client = await ClientModel.findOneAndUpdate(
      { _id: clientId, ...tenantScope(auth) },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!client) throw new AppError('NOT_FOUND', 'Client not found.');
    return client;
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateNameError(data.name ?? '');
    throw error;
  }
}

/**
 * Deletion rules: only owners/admins (enforced by the route), only within the
 * caller's organization, and only once the client has no catalogue jobs — so
 * job history, product rows and exports are never orphaned.
 */
export async function deleteClient(auth: AuthContext, clientId: string): Promise<void> {
  const client = await getClient(auth, clientId);
  const jobCount = await CatalogJobModel.countDocuments({ clientId: client._id, ...tenantScope(auth) });
  if (jobCount > 0) {
    throw new AppError(
      'CONFLICT',
      `This client has ${jobCount} catalogue job${jobCount === 1 ? '' : 's'}. Delete ${jobCount === 1 ? 'it' : 'them'} before deleting the client.`,
    );
  }
  const result = await ClientModel.deleteOne({ _id: clientId, ...tenantScope(auth) });
  if (result.deletedCount === 0) throw new AppError('NOT_FOUND', 'Client not found.');
}
