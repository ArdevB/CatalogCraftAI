import type { Types } from 'mongoose';
import { DEFAULT_BRAND_PROFILE, type BrandProfile } from '@catalogcraft/shared';
import { ClientModel } from '../clients/client.model.js';
import { OrganizationModel } from './organization.model.js';

/**
 * A client's brand profile with the agency-wide content rules added. Used
 * everywhere rules are enforced — the AI prompt, the guardrails and reviewer
 * edits — so an agency rule like "never say guaranteed" applies to every client.
 */
export function mergeContentRules(brand: BrandProfile, agencyProhibitedClaims: readonly string[]): BrandProfile {
  const seen = new Set<string>();
  const prohibitedClaims = [...brand.prohibitedClaims, ...agencyProhibitedClaims].filter((claim) => {
    const key = claim.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...brand, prohibitedClaims };
}

/** Loads a client's brand profile merged with its organization's content rules. */
export async function effectiveBrandProfile(
  organizationId: Types.ObjectId | string,
  clientId: Types.ObjectId | string,
): Promise<BrandProfile> {
  const [client, organization] = await Promise.all([
    ClientModel.findOne({ _id: clientId, organizationId }).select('brandProfile').lean(),
    OrganizationModel.findById(organizationId).select('contentRules').lean(),
  ]);
  const brand: BrandProfile = client?.brandProfile
    ? {
        ...client.brandProfile,
        preferredTerminology: [...client.brandProfile.preferredTerminology],
        prohibitedClaims: [...client.brandProfile.prohibitedClaims],
        defaultLanguage: client.brandProfile.defaultLanguage as BrandProfile['defaultLanguage'],
      }
    : DEFAULT_BRAND_PROFILE;
  return mergeContentRules(brand, organization?.contentRules?.prohibitedClaims ?? []);
}
