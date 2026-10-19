import { z } from 'zod';
import { jobStatusSchema } from './catalog.js';
import { languageCodeSchema } from './language.js';
import { paginationMetaSchema, paginationQuerySchema } from './common.js';
import { planIdSchema } from './organization.js';


export const BRAND_LIST_MAX_ITEMS = 50;
export const TITLE_LENGTH_MIN = 20;
export const TITLE_LENGTH_MAX = 255;

const brandListSchema = (label: string) =>
  z
    .array(z.string().trim().min(1, `${label} entries cannot be empty.`).max(200, `${label} entries must be at most 200 characters.`))
    .max(BRAND_LIST_MAX_ITEMS, `Add at most ${BRAND_LIST_MAX_ITEMS} ${label.toLowerCase()} entries.`);

/** The brand profile fields, without defaults (used for responses and partial updates). */
const brandProfileShape = {
  brandTone: z.string().trim().max(500, 'Brand tone must be at most 500 characters.'),
  targetAudience: z.string().trim().max(500, 'Target audience must be at most 500 characters.'),
  preferredTerminology: brandListSchema('Preferred terminology'),
  prohibitedClaims: brandListSchema('Prohibited claims'),
  defaultLanguage: languageCodeSchema,
  maxTitleLength: z
    .number({ error: 'Enter a whole number.' })
    .int('Enter a whole number.')
    .min(TITLE_LENGTH_MIN, `Title length must be at least ${TITLE_LENGTH_MIN}.`)
    .max(TITLE_LENGTH_MAX, `Title length must be at most ${TITLE_LENGTH_MAX}.`),
};

export const brandProfileSchema = z.object(brandProfileShape);
export type BrandProfile = z.infer<typeof brandProfileSchema>;

export const DEFAULT_BRAND_PROFILE: BrandProfile = {
  brandTone: '',
  targetAudience: '',
  preferredTerminology: [],
  prohibitedClaims: [],
  defaultLanguage: 'en',
  maxTitleLength: 150,
};

/** Used when creating a client: anything left out gets the default. */
const brandProfileInputSchema = z.object({
  brandTone: brandProfileShape.brandTone.default(DEFAULT_BRAND_PROFILE.brandTone),
  targetAudience: brandProfileShape.targetAudience.default(DEFAULT_BRAND_PROFILE.targetAudience),
  preferredTerminology: brandProfileShape.preferredTerminology.default([]),
  prohibitedClaims: brandProfileShape.prohibitedClaims.default([]),
  defaultLanguage: brandProfileShape.defaultLanguage.default(DEFAULT_BRAND_PROFILE.defaultLanguage),
  maxTitleLength: brandProfileShape.maxTitleLength.default(DEFAULT_BRAND_PROFILE.maxTitleLength),
});

export const clientNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a client name.')
  .max(120, 'Client name must be at most 120 characters.');

export const internalReferenceSchema = z
  .string()
  .trim()
  .max(60, 'Internal reference must be at most 60 characters.');

export const createClientSchema = z.object({
  name: clientNameSchema,
  internalReference: internalReferenceSchema.optional(),
  // `prefault` runs the defaults above when the whole object is omitted.
  brandProfile: brandProfileInputSchema.prefault({}),
});
/** What a form/request may send. */
export type CreateClientInput = z.input<typeof createClientSchema>;
/** After validation: trimmed, with every brand profile default filled in. */
export type CreateClientData = z.output<typeof createClientSchema>;

export const updateClientSchema = z
  .object({
    name: clientNameSchema.optional(),
    /** An empty string or `null` removes the reference. */
    internalReference: internalReferenceSchema.nullable().optional(),
    brandProfile: z.object(brandProfileShape).partial().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Provide at least one field to update.',
  });
export type UpdateClientInput = z.input<typeof updateClientSchema>;
export type UpdateClientData = z.output<typeof updateClientSchema>;

export const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  internalReference: z.string().nullable(),
  brandProfile: brandProfileSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Client = z.infer<typeof clientSchema>;

export const clientListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100, 'Search text is too long.').optional(),
});
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;

/** How many client workspaces exist and how many the plan allows (`null` = unlimited). */
export const workspaceAllowanceSchema = z.object({
  used: z.number().int().min(0),
  limit: z.number().int().min(0).nullable(),
});
export type WorkspaceAllowance = z.infer<typeof workspaceAllowanceSchema>;

export const clientListSchema = z.object({
  items: z.array(clientSchema),
  pagination: paginationMetaSchema,
  allowance: workspaceAllowanceSchema,
});
export type ClientList = z.infer<typeof clientListSchema>;

export const dashboardSummarySchema = z.object({
  plan: planIdSchema,
  clients: workspaceAllowanceSchema,
  recentClients: z.array(clientSchema.pick({ id: true, name: true, updatedAt: true })),
  /** Products enriched this month vs. the plan allowance (`null` = unlimited). */
  products: z.object({ used: z.number().int(), limit: z.number().int().nullable() }),
  jobs: z.object({
    active: z.number().int().min(0),
    activeLimit: z.number().int().min(0).nullable(),
    needsReview: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
  recentJobs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: jobStatusSchema,
      clientName: z.string(),
      updatedAt: z.iso.datetime(),
    }),
  ),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
