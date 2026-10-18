import { Types } from 'mongoose';
import type { AuthContext } from '../middleware/require-auth.js';

/**
 * THE tenant-isolation rule: every query on organization-owned data must
 * include this filter. Looking a record up by its id alone is never enough —
 * a user who learns another agency's client or job id must still get "not
 * found", because the organizationId does not match theirs.
 *
 *   ClientModel.findOne({ _id: clientId, ...tenantScope(auth) })
 */
export function tenantScope(auth: Pick<AuthContext, 'organizationId'>): { organizationId: Types.ObjectId } {
  return { organizationId: new Types.ObjectId(auth.organizationId) };
}
