import type { Types } from 'mongoose';
import type { Organization as OrganizationDto } from '@catalogcraft/shared';
import type { Organization } from './organization.model.js';

/**
 * Converts a database document into the public API shape. Handlers never
 * return raw documents, so internal fields can't leak by accident.
 */
export function toOrganizationDto(org: Organization & { _id: Types.ObjectId }): OrganizationDto {
  return {
    id: org._id.toString(),
    name: org.name,
    plan: org.plan,
    subscriptionStatus: org.subscriptionStatus,
    createdAt: org.createdAt.toISOString(),
  };
}
